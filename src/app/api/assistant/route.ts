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
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  assistantClient,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MODEL,
  buildSystemPrompt,
  isAssistantConfigured,
  normalizeMessages,
} from "@/lib/ai/assistant";
import {
  checkRateLimit,
  ASSISTANT_PER_USER,
  ASSISTANT_PER_FIRM_DAILY,
} from "@/lib/rate-limit";

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

  const system = buildSystemPrompt({
    locale: body.locale,
    pathname: body.pathname,
    firmName: firm.name,
    userDisplayName: userDisplayLabel(user),
    isDemoFirm: firm.is_demo,
  });

  // Stream the response as plain UTF-8 text. Each text_delta event
  // from Anthropic appends to the body. The client reads
  // `response.body` and concatenates chunks.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const sdkStream = await client.messages.stream({
          model: ASSISTANT_MODEL,
          max_tokens: ASSISTANT_MAX_TOKENS,
          system,
          messages,
        });

        for await (const event of sdkStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
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
