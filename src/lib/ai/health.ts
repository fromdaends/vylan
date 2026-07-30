// Is the document reader actually able to read anything right now?
//
// WHY: on 2026-07-30 the OpenAI credit balance hit zero. Nothing in the product
// knew. Uploads kept succeeding, jobs kept failing with "429 You exceeded your
// current quota", and the only visible symptom was a document spinning on
// "Reading…" — discovered live, in front of a client. There was no way to ask
// "is the AI working?" and get an answer.
//
// This makes the smallest possible real call to each configured provider. It
// costs a few tokens and answers the one question that matters: if a document
// arrived right now, would it get read?

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getProvider, getOpenAiModel } from "./classify";
import { providerChain, describeProviderError, type AiProvider } from "./failover";

export type ProviderHealth = {
  provider: AiProvider;
  /** true = this provider answered; it can read documents right now. */
  ok: boolean;
  /** The vendor's own message when it can't — this is what names the fix. */
  error: string | null;
  /** true = this is the provider the firm configured as primary. */
  primary: boolean;
  ms: number;
};

export type AiHealth = {
  /** false = NO provider can read a document. The product is down for AI. */
  healthy: boolean;
  /** true = the primary is dead but a parachute answered. Worth a warning. */
  degraded: boolean;
  providers: ProviderHealth[];
  checkedAt: string;
};

async function pingOpenAi(): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) throw new Error("no OPENAI_API_KEY");
  const client = new OpenAI({ apiKey: key, timeout: 15_000, maxRetries: 0 });
  // Smallest call that still exercises auth + quota + the configured model.
  await client.chat.completions.create({
    model: getOpenAiModel(),
    messages: [{ role: "user", content: "ok" }],
    max_completion_tokens: 1,
  });
}

async function pingAnthropic(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key?.trim()) throw new Error("no ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key, timeout: 15_000, maxRetries: 0 });
  await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1,
    messages: [{ role: "user", content: "ok" }],
  });
}

// PURE: roll per-provider results into the overall verdict. Exported for tests.
export function summarize(providers: ProviderHealth[]): {
  healthy: boolean;
  degraded: boolean;
} {
  const healthy = providers.some((p) => p.ok);
  const primary = providers.find((p) => p.primary);
  // Degraded = a document would still be read, but not by the provider the
  // firm chose. That's a working product on a parachute, and someone should
  // know before the parachute also fails.
  const degraded = healthy && primary != null && !primary.ok;
  return { healthy, degraded };
}

export async function checkAiHealth(): Promise<AiHealth> {
  const primary = getProvider();
  const chain = providerChain(primary);
  const providers = await Promise.all(
    chain.map(async (provider): Promise<ProviderHealth> => {
      const started = Date.now();
      try {
        if (provider === "openai") await pingOpenAi();
        else await pingAnthropic();
        return {
          provider,
          ok: true,
          error: null,
          primary: provider === primary,
          ms: Date.now() - started,
        };
      } catch (e) {
        return {
          provider,
          ok: false,
          error: describeProviderError(e),
          primary: provider === primary,
          ms: Date.now() - started,
        };
      }
    }),
  );
  return {
    ...summarize(providers),
    providers,
    checkedAt: new Date().toISOString(),
  };
}
