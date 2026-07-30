// Provider failover for every paid AI read.
//
// WHY THIS EXISTS: on 2026-07-30 the OpenAI account's credit balance hit zero
// mid-demo. Every document read came back
//
//   429 You exceeded your current quota, please check your plan and billing
//
// The classifier was pinned to the single configured provider, so it retried
// the dead vendor five times and gave up. Documents sat on "Reading…" forever
// and the product looked broken in front of a client. Anthropic was wired up
// and working the whole time; nothing tried it.
//
// A billing problem at one vendor must never be able to stop document reads.
// So: try the configured provider first, and if it cannot serve, fail straight
// over to the other one. Same prompt, same schema, same parser — the two paths
// already returned the same raw object shape, which is what makes this safe.
//
// Note this is a FAILOVER, not a load balancer: the configured provider is
// always tried first, so the accuracy characteristics the firm chose are what
// they get on the happy path. The other provider is the parachute.

import { isOpenAiConfigured } from "./openai-classify";

export type AiProvider = "openai" | "anthropic";

export function hasKeyFor(provider: AiProvider): boolean {
  // Anthropic's key is read directly rather than through classify.ts, which
  // imports this module — going back the other way would be a cycle.
  return provider === "openai"
    ? isOpenAiConfigured()
    : Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// PURE: the order to try providers in, given the configured primary and which
// keys exist. The primary comes first; the other follows as the parachute.
// A provider with no key is dropped — calling it would only waste a round trip.
export function orderProviders(
  primary: AiProvider,
  keyed: (p: AiProvider) => boolean,
): AiProvider[] {
  const other: AiProvider = primary === "openai" ? "anthropic" : "openai";
  return [primary, other].filter(keyed);
}

// The live chain for this deployment.
export function providerChain(primary: AiProvider): AiProvider[] {
  return orderProviders(primary, hasKeyFor);
}

// Short, log-safe description of why a provider was skipped. Never includes the
// API key or the document.
export function describeProviderError(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 300);
  return String(e).slice(0, 300);
}

// Run `attempt` against each provider in turn and return the first non-null
// result.
//
// ANY throw is treated as "this vendor cannot serve right now" — quota, auth,
// billing, rate limit, timeout, 5xx, DNS. We deliberately do NOT try to
// classify which errors are worth failing over on: the whole point is that the
// read still happens, and the cost of one extra call is nothing next to a
// document that never gets read. A provider returning null (an empty or
// unparseable reply) is also treated as a miss and the next one is tried.
//
// If every provider fails, the FIRST error is rethrown — that's the configured
// provider's error, which is the one describing what the firm needs to fix
// (e.g. the billing message above). Nothing is swallowed: callers still see a
// hard failure when the whole chain is down.
export async function withProviderFailover<T>(
  label: string,
  chain: AiProvider[],
  attempt: (provider: AiProvider) => Promise<T | null>,
): Promise<T | null> {
  let firstError: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    try {
      const result = await attempt(provider);
      if (result != null) {
        if (i > 0) {
          console.warn(
            `[ai/${label}] served by FAILOVER provider=${provider} (primary=${chain[0]} unavailable)`,
          );
        }
        return result;
      }
      console.warn(`[ai/${label}] provider=${provider} returned nothing`);
    } catch (e) {
      if (firstError == null) firstError = e;
      console.error(
        `[ai/${label}] provider=${provider} unavailable: ${describeProviderError(e)}`,
      );
    }
  }
  if (firstError != null) throw firstError;
  return null;
}
