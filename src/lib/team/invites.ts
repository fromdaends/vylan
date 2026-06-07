// Pure domain helpers for teammate invitations. NOT a "use server" module —
// imported by the server actions in src/app/actions/team.ts and by the Phase 3
// accept flow. Kept free of Supabase/auth so the logic stays unit-testable.

import { createHash, randomBytes } from "crypto";
import { z } from "zod";

// Single-use invite lifetime. Resending mints a fresh token + resets this.
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Raw token: 32 random bytes, URL-safe (base64url => only A-Za-z0-9-_) so it
// can sit in a path segment (/{locale}/invite/{token}) without encoding.
// Emailed once and never stored — only its hash is persisted.
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

// What we persist + look up by: SHA-256 hex of the raw token. Deterministic so
// the accept flow can hash the incoming token and match the stored hash.
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ISO expiry, INVITE_TTL_DAYS from `fromMs` (default: now).
export function inviteExpiryISO(fromMs: number = Date.now()): string {
  return new Date(fromMs + INVITE_TTL_DAYS * DAY_MS).toISOString();
}

// Accept-page URL: {appUrl}/{locale}/invite/{rawToken}. Strips a trailing slash
// on appUrl defensively so we never emit a double slash.
export function inviteAcceptUrl(
  appUrl: string,
  locale: "fr" | "en",
  rawToken: string,
): string {
  return `${appUrl.replace(/\/$/, "")}/${locale}/invite/${rawToken}`;
}

// Email validation: trim + lowercase, must be a syntactically valid email.
export const inviteEmailSchema = z.string().trim().toLowerCase().email();

export function parseInviteEmail(
  raw: unknown,
): { ok: true; email: string } | { ok: false } {
  const parsed = inviteEmailSchema.safeParse(raw);
  return parsed.success ? { ok: true, email: parsed.data } : { ok: false };
}

// Lifecycle state of an invite row at a given moment. Used by the accept flow
// (Phase 3) to gate "is this invite still usable?" and by the team list (Phase
// 6). revoked beats accepted beats expired beats pending.
export type InviteRow = {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
};
export type InviteState = "pending" | "accepted" | "revoked" | "expired";

export function inviteState(
  invite: InviteRow,
  nowMs: number = Date.now(),
): InviteState {
  if (invite.revoked_at) return "revoked";
  if (invite.accepted_at) return "accepted";
  if (Date.parse(invite.expires_at) <= nowMs) return "expired";
  return "pending";
}
