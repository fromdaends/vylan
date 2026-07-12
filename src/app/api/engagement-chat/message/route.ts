// POST /api/engagement-chat/message — the engagement chat turn endpoint
// (Assistant panel, phase 2: read/search only, no actions).
//
// Flow: auth → backstop rate limit → validate body → bind the ONE engagement
// (RLS read; the model never chooses an engagement) → DB rolling-window rate
// limit (CHAT_MESSAGE_LIMIT per CHAT_WINDOW_HOURS per user, counted from
// chat_messages) → persist the user turn → run a bounded tool loop on the
// chat model → stream NDJSON events → persist the assistant turn.
//
// Wire protocol (one JSON object per line):
//   {"t":"delta","text":"..."}   streamed answer text
//   {"t":"tool","name":"..."}    a lookup started (UI shows "checking…")
//   {"t":"done","remaining":N,"resetAt":ISO|null,"limit":N}
//   {"t":"error","code":"stream_failed"}
// Pre-stream failures return plain JSON {error} with a proper status code.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { checkRateLimit } from "@/lib/rate-limit";
import { getFirmAiUsage, incrementFirmAiUsage } from "@/lib/ai/usage";
import { assistantClient, isAssistantConfigured } from "@/lib/ai/assistant";
import {
  CHAT_HISTORY_MESSAGES,
  CHAT_MAX_MESSAGE_CHARS,
  CHAT_MAX_TOKENS,
  CHAT_MAX_TOOL_ROUNDS,
  CHAT_MODEL,
  CHAT_PER_FIRM_DAILY,
  CHAT_WINDOW_HOURS,
} from "@/lib/engagement-chat/config";
import { computeChatLimitState } from "@/lib/engagement-chat/limit";
import {
  CHAT_SCHEMA_MISSING,
  getConversationId,
  insertChatMessage,
  listChatMessages,
  listUserTurnTimes,
} from "@/lib/engagement-chat/db";
import {
  fetchChatEngagement,
  fetchClientName,
} from "@/lib/engagement-chat/data";
import { buildEngagementChatPrompt } from "@/lib/engagement-chat/prompt";
import {
  CHAT_ACTION_TOOLS,
  CHAT_TOOLS,
  createChatToolContext,
  runChatTool,
} from "@/lib/engagement-chat/tools";
import { listRecentActionSummaries } from "@/lib/engagement-chat/pending-actions";
import { ACTION_CONTEXT_COUNT } from "@/lib/engagement-chat/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z.object({
  engagementId: z.string().regex(UUID_RE),
  message: z.string().min(1).max(CHAT_MAX_MESSAGE_CHARS),
  locale: z.enum(["en", "fr"]).default("fr"),
});

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return jsonError(401, "unauthorized");

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return jsonError(401, "unauthorized");
  // Same rule as the other engagement-chat routes: this endpoint is polled/
  // called client-side without re-rendering the app layout, so it must
  // enforce the deactivated flag itself.
  if (user.deactivated_at) return jsonError(401, "unauthorized");

  // Upstash backstop (fails open when unconfigured). The real product limit
  // is the DB window below; this only caps a whole firm's daily burn.
  const perFirm = await checkRateLimit({
    key: `engagement-chat:firm:${firm.id}`,
    ...CHAT_PER_FIRM_DAILY,
  });
  if (!perFirm.ok) {
    const res = jsonError(429, "rate_limited");
    if (perFirm.retryAfter) {
      res.headers.set("Retry-After", String(perFirm.retryAfter));
    }
    return res;
  }

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return jsonError(400, "bad_request");
    body = parsed.data;
  } catch {
    return jsonError(400, "bad_request");
  }

  // Bind the ONE engagement. RLS makes another firm's engagement (or a bogus
  // id) read as absent → 404, the repo's standard authorization idiom.
  const engagement = await fetchChatEngagement(supabase, body.engagementId);
  if (!engagement) return jsonError(404, "not_found");

  if (!isAssistantConfigured()) return jsonError(503, "chat_not_ready");
  const client = assistantClient();
  if (!client) return jsonError(503, "chat_not_ready");

  // Conversation + rolling-window limit — both live in the 0550 tables; a
  // missing schema means the migration hasn't been applied yet.
  const conversationId = await getConversationId(
    supabase,
    firm.id,
    body.engagementId,
    { create: true },
  );
  if (conversationId === CHAT_SCHEMA_MISSING || conversationId === null) {
    return jsonError(503, "chat_not_ready");
  }

  const nowMs = Date.now();
  const sinceIso = new Date(
    nowMs - CHAT_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const turnTimes = await listUserTurnTimes(supabase, user.id, sinceIso);
  if (turnTimes === CHAT_SCHEMA_MISSING) return jsonError(503, "chat_not_ready");

  const limitState = computeChatLimitState(turnTimes, nowMs);
  if (limitState.remaining <= 0) {
    return jsonError(429, "chat_limit", {
      limit: limitState.limit,
      resetAt: limitState.resetAt,
    });
  }

  // Trial firms share the small lifetime AI budget with document analysis —
  // same gate (and same reserve-before-call accounting) as the help
  // assistant. Paid firms are governed by the message window alone.
  const aiUsage = await getFirmAiUsage(firm.id);
  if (aiUsage.isTrial && aiUsage.paused) return jsonError(403, "trial_limit");
  if (aiUsage.isTrial) await incrementFirmAiUsage(firm.id);

  // History for the model (before persisting the new turn so it isn't
  // duplicated), then persist the user turn — it counts even if the model
  // call fails, conservative like the trial reserve.
  const history = await listChatMessages(
    supabase,
    conversationId,
    CHAT_HISTORY_MESSAGES,
  );
  if (history === CHAT_SCHEMA_MISSING) return jsonError(503, "chat_not_ready");

  const userText = body.message.slice(0, CHAT_MAX_MESSAGE_CHARS).trim();
  if (!userText) return jsonError(400, "bad_request");

  const inserted = await insertChatMessage(supabase, {
    conversationId,
    firmId: firm.id,
    userId: user.id,
    role: "user",
    content: userText,
  });
  if (inserted === CHAT_SCHEMA_MISSING) return jsonError(503, "chat_not_ready");

  // Post-send limit state, reported on the done event.
  const postState = computeChatLimitState(
    [...turnTimes, new Date(nowMs).toISOString()],
    nowMs,
  );

  // Recent proposals feed the prompt so "did you send it?" follow-ups answer
  // from real card state. Schema-missing (0560 not applied) = no actions yet.
  const [clientName, recentSummaries] = await Promise.all([
    fetchClientName(supabase, engagement.client_id),
    listRecentActionSummaries(supabase, conversationId, ACTION_CONTEXT_COUNT),
  ]);
  const system = buildEngagementChatPrompt({
    locale: body.locale,
    firmName: firm.name,
    userDisplayName: userDisplayLabel(user),
    engagement: {
      title: engagement.title,
      clientName,
      status: engagement.status,
      dueDate: engagement.due_date,
    },
    recentActions:
      recentSummaries === CHAT_SCHEMA_MISSING ? undefined : recentSummaries,
    // When cards are off the model should phrase actions as done, not "waiting
    // for Confirm" — the server executes them inline (deletions still confirm).
    autoConfirmActions: firm.chat_confirm_actions === false,
  });

  // Model conversation = persisted history + the new turn. First message
  // must be a user turn (Anthropic requirement) — drop a leading assistant
  // tail if the history window cut mid-exchange.
  const modelMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  modelMessages.push({ role: "user", content: userText });
  while (modelMessages.length > 0 && modelMessages[0].role !== "user") {
    modelMessages.shift();
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      const textParts: string[] = [];
      // Proposal cards stream to the panel the moment a propose_* tool
      // lands, carrying the browser-only confirmation token.
      const toolCtx = createChatToolContext({
        sb: supabase,
        engagementId: body.engagementId,
        firmId: firm.id,
        userId: user.id,
        conversationId,
        onProposal: (card) => emit({ t: "action", action: card }),
        // Firm turned "send confirmation cards" off → server auto-executes
        // proposed actions (deletions excepted). Undefined pre-0570 defaults
        // to confirmation ON (=== false is false), the safe behavior.
        autoConfirm: firm.chat_confirm_actions === false,
      });
      const allTools = [...CHAT_TOOLS, ...CHAT_ACTION_TOOLS];

      try {
        for (let round = 0; round < CHAT_MAX_TOOL_ROUNDS; round++) {
          // On the last allowed round the model must ANSWER: without this, a
          // lookup-happy turn could burn every round on tool calls and end
          // with no text at all (quota spent, user gets silence).
          const isFinalRound = round === CHAT_MAX_TOOL_ROUNDS - 1;
          const sdkStream = client.messages.stream(
            {
              model: CHAT_MODEL,
              max_tokens: CHAT_MAX_TOKENS,
              system,
              tools: allTools,
              ...(isFinalRound ? { tool_choice: { type: "none" as const } } : {}),
              messages: modelMessages,
            },
            // Bound each round so a hung read can't eat the whole function
            // budget (SDK default timeout is 10 min; maxDuration here is 60s).
            { timeout: 40_000, maxRetries: 1 },
          );

          let roundText = "";
          for await (const event of sdkStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              roundText += event.delta.text;
              emit({ t: "delta", text: event.delta.text });
            } else if (
              event.type === "content_block_start" &&
              event.content_block.type === "tool_use"
            ) {
              emit({ t: "tool", name: event.content_block.name });
            }
          }
          if (roundText.trim()) textParts.push(roundText.trim());

          const finalMessage = await sdkStream.finalMessage();
          if (finalMessage.stop_reason !== "tool_use") break;

          const toolUses = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          modelMessages.push({
            role: "assistant",
            content: finalMessage.content,
          });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            const result = await runChatTool(use.name, use.input, toolCtx);
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: JSON.stringify(result),
            });
          }
          modelMessages.push({ role: "user", content: results });
          // Visual paragraph break between pre-tool narration and the
          // post-lookup answer, mirroring what the panel displayed.
          if (roundText.trim()) emit({ t: "delta", text: "\n\n" });
        }

        // Belt-and-suspenders: if the loop somehow ended with zero text
        // (e.g. a max_tokens cut mid-tool-call), give the user an honest
        // line instead of silence — the turn was still counted.
        if (textParts.join("").trim() === "") {
          const fallback =
            body.locale === "fr"
              ? "Désolé, je n'ai pas réussi à formuler une réponse. Reformulez votre question et réessayez."
              : "Sorry, I couldn't put an answer together. Rephrase your question and try again.";
          textParts.push(fallback);
          emit({ t: "delta", text: fallback });
        }

        // Persist the assistant turn exactly as the panel displayed it.
        const assistantText = textParts.join("\n\n").trim();
        if (assistantText) {
          const saved = await insertChatMessage(supabase, {
            conversationId,
            firmId: firm.id,
            userId: null,
            role: "assistant",
            content: assistantText,
          });
          if (saved === CHAT_SCHEMA_MISSING) {
            // Mid-request rollback of the migration — vanishingly unlikely;
            // the reply was still delivered, only persistence was lost.
            console.error("[engagement-chat] schema vanished mid-turn");
          }
        }

        emit({
          t: "done",
          remaining: postState.remaining,
          resetAt: postState.resetAt,
          limit: postState.limit,
        });
        controller.close();
      } catch (err) {
        console.error("[engagement-chat] stream failed:", err);
        try {
          emit({ t: "error", code: "stream_failed" });
        } catch {
          // controller may already be closed
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
