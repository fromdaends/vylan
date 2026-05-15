// Schemas + types for MFA actions. Lives outside the "use server" module
// because Next.js 16 forbids non-async-function exports from those files.

import { z } from "zod";

// Result returned by enrollMfaAction — the UI uses qr_code (data URI) to
// render the scannable image and secret as a copyable text fallback.
export type EnrollMfaResult =
  | {
      ok: true;
      factor_id: string;
      qr_code: string;
      secret: string;
    }
  | {
      ok: false;
      error: "unauth" | "rate_limited" | "enroll_failed";
    };

// Result returned by verifyMfaEnrollAction. On success it also returns
// the freshly-generated plaintext recovery codes — shown to the user
// EXACTLY ONCE.
export type VerifyMfaEnrollResult =
  | {
      ok: true;
      recovery_codes: string[];
    }
  | {
      ok: false;
      error: "unauth" | "rate_limited" | "bad_code" | "save_failed";
    };

export type DisableMfaResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauth" | "wrong_password" | "rate_limited" | "disable_failed";
    };

export type VerifyMfaChallengeResult =
  | {
      ok: true;
      // `recovery_used` is true when the user redeemed a recovery code,
      // which auto-tears-down MFA. The challenge page shows a notice so
      // the user knows to re-enroll.
      recovery_used: boolean;
    }
  | {
      ok: false;
      error: "unauth" | "rate_limited" | "bad_code" | "no_factor";
    };

export const VerifyEnrollSchema = z.object({
  factor_id: z.string().min(1),
  code: z.string().min(6).max(8),
});

export const DisableMfaSchema = z.object({
  password: z.string().min(8),
});

export const VerifyChallengeSchema = z.object({
  code: z.string().min(6).max(32),
});
