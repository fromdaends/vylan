// Verify the authenticity of an incoming SignWell webhook event.
//
// SignWell signs each event with an HMAC-SHA256 over `${type}@${time}`, keyed by
// the per-webhook "Webhook ID", and puts the hex digest in event.hash. We
// recompute it and compare in constant time. Server-only (Node crypto) — kept in
// its own file so the client bundle never pulls it in.

import { createHmac, timingSafeEqual } from "crypto";

export function isValidSignwellEventHash(input: {
  type: string;
  // SignWell sends a unix timestamp; it is stringified into the signed payload.
  time: string | number;
  hash: string;
  webhookId: string;
}): boolean {
  const { type, time, hash, webhookId } = input;
  if (!webhookId || !hash || !type) return false;
  const data = `${type}@${time}`;
  const expected = createHmac("sha256", webhookId).update(data).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
