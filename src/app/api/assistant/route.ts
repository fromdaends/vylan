// In-app help assistant ("Ask Vylan") streaming endpoint.
//
// The client POSTs the conversation so far plus a bit of UI context
// (locale, current pathname). The server validates auth, runs a
// per-user + per-firm rate limit, then streams Claude's reply back
// as plain text chunks. The client reads `response.body` and appends
// chunks as they arrive.
//
// We don't persist conversations server-side. Each turn includes the
// full history from the client.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  assistantClient,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MAX_TOOL_ROUNDS,
  ASSISTANT_MODEL,
  buildSystemPrompt,
  isAssistantConfigured,
  normalizeMessages,
} from "@/lib/ai/assistant";
import {
  ASSISTANT_READ_TOOLS,
  createAssistantReadContext,
  runAssistantReadTool,
} from "@/lib/assistant/read-tools";
import {
  checkRateLimit,
  ASSISTANT_PER_USER,
  ASSISTANT_PER_FIRM_DAILY,
} from "@/lib/rate-limit";
import { getFirmAiUsage, incrementFirmAiUsage } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1),
  locale: z.enum(["en", "fr"]).default("en"),
  pathname: z.string().max(500).optional(),
});

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  // Auth — the assistant lives behind the (app) layout and is only
  // ever rendered for signed-in firm users. Still re-verify here so
  // a stolen path can't bypass.
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return jsonError(401, "unauthorized");
  }

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) {
    return jsonError(401, "unauthorized");
  }

  // Rate limit BEFORE we hit the model.
  const perUser = await checkRateLimit({
    key: `assistant:user:${user.id}`,
    ...ASSISTANT_PER_USER,
  });
  if (!perUser.ok) {
    const res = jsonError(429, "rate_limited");
    if (perUser.retryAfter) {
      res.headers.set("Retry-After", String(perUser.retryAfter));
    }
    return res;
  }
  const perFirm = await checkRateLimit({
    key: `assistant:firm:${firm.id}`,
    ...ASSISTANT_PER_FIRM_DAILY,
  });
  if (!perFirm.ok) {
    const res = jsonError(429, "rate_limited");
    if (perFirm.retryAfter) {
      res.headers.set("Retry-After", String(perFirm.retryAfter));
    }
    return res;
  }

  // Body shape.
  let body: z.infer<typeof Body>;
  try {
    const json = await request.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) return jsonError(400, "bad_request");
    body = parsed.data;
  } catch {
    return jsonError(400, "bad_request");
  }

  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) return jsonError(400, "empty_messages");

  // If the API key isn't configured (local dev without the key, or
  // a misconfigured deploy), return a deterministic friendly text so
  // the UI can still demo. We don't 500 — that would look broken to
  // anyone testing the feature.
  if (!isAssistantConfigured()) {
    const stub =
      body.locale === "fr"
        ? "L'assistant IA n'est pas encore configuré sur cet environnement. Pour des questions, écrivez-nous à hello@vylan.app."
        : "The AI assistant isn't configured in this environment yet. For questions please email hello@vylan.app.";
    return new Response(stub, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-assistant-stub": "1",
      },
    });
  }

  const client = assistantClient();
  if (!client) return jsonError(500, "ai_unavailable");

  // Free-trial firms share ONE small lifetime AI budget across BOTH document
  // analysis AND this assistant (TRIAL_AI_TOTAL_CAP) — otherwise a trial could
  // burn unbounded paid Claude calls here, outside the document cap. Block once
  // the budget is spent, and count this turn against it (reserve BEFORE the
  // model call — conservative if the stream then fails). Trial firms only; paid
  // firms' monthly document meter is untouched.
  const aiUsage = await getFirmAiUsage(firm.id);
  if (aiUsage.isTrial && aiUsage.paused) {
    const msg =
      body.locale === "fr"
        ? "Vous avez atteint la limite d’IA de votre essai gratuit. Passez à un forfait pour continuer à utiliser l’assistant IA."
        : "You've reached your free trial's AI limit. Upgrade to keep using the AI assistant.";
    return new Response(msg, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-assistant-limit": "1",
      },
    });
  }
  if (aiUsage.isTrial) await incrementFirmAiUsage(firm.id);

  const system = buildSystemPrompt({
    locale: body.locale,
    pathname: body.pathname,
    firmName: firm.name,
    userDisplayName: userDisplayLabel(user),
    isDemoFirm: firm.is_demo,
    // The assistant can look up (read-only) the firm's real engagements and
    // documents to answer and summarize — no engagement selector, no actions.
    canReadFirmData: true,
  });

  // Model conversation; grows as the read-tool loop appends tool_use /
  // tool_result turns. Content starts as the plain strings from the client.
  const modelMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const readCtx = createAssistantReadContext({ sb: supabase, firmId: firm.id });

  // Stream the answer as plain UTF-8 text. Read-tool lookups happen
  // server-side between rounds (their tool_use blocks are never streamed to
  // the client); only the model's answer text reaches the browser, so the
  // existing plain-text reader keeps working unchanged.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let round = 0; round < ASSISTANT_MAX_TOOL_ROUNDS; round++) {
          // Final allowed round: force an answer (tool_choice none) so a
          // lookup-happy turn can't end with tool calls and no text.
          const isFinalRound = round === ASSISTANT_MAX_TOOL_ROUNDS - 1;
          const sdkStream = client.messages.stream(
            {
              model: ASSISTANT_MODEL,
              max_tokens: ASSISTANT_MAX_TOKENS,
              system,
              tools: ASSISTANT_READ_TOOLS,
              ...(isFinalRound
                ? { tool_choice: { type: "none" as const } }
                : {}),
              messages: modelMessages,
            },
            { timeout: 40_000, maxRetries: 1 },
          );

          let roundText = "";
          for await (const event of sdkStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              roundText += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

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
            const result = await runAssistantReadTool(
              use.name,
              use.input,
              readCtx,
            );
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: JSON.stringify(result),
            });
          }
          modelMessages.push({ role: "user", content: results });
          // Paragraph break between any pre-lookup narration and the answer.
          if (roundText.trim()) controller.enqueue(encoder.encode("\n\n"));
        }
        controller.close();
      } catch (err) {
        console.error("[api/assistant] stream failed:", err);
        // Best-effort terminal message so the client doesn't show a
        // truncated reply with no explanation.
        try {
          controller.enqueue(
            encoder.encode(
              body.locale === "fr"
                ? "\n\n(Désolé, une erreur est survenue. Réessayez ou écrivez à hello@vylan.app.)"
                : "\n\n(Sorry, something went wrong. Try again or email hello@vylan.app.)",
            ),
          );
        } catch {
          // controller may already be closed
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
