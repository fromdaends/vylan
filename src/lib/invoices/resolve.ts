// Pure helpers for invoice automation (migration 0590), shared by the builder
// UI and unit tests so the "what amount / when" rules live in one tested place.

export type InvoiceAutoMode = "off" | "on_completion" | "delayed";

// The amount to bill (cents) from the accountant's invoice choices, or null
// when it can't be determined: mode 'off', or a custom amount that isn't a
// valid figure (Stripe's floor is $0.50). Prefers the firm's saved default when
// "use default" is chosen and a default exists; otherwise parses the custom $.
export function resolveInvoiceAmountCents(opts: {
  mode: InvoiceAutoMode;
  useDefault: boolean;
  defaultCents: number | null;
  customAmount: string;
}): number | null {
  if (opts.mode === "off") return null;
  if (opts.useDefault && opts.defaultCents != null && opts.defaultCents > 0) {
    return opts.defaultCents;
  }
  const dollars = Number.parseFloat(opts.customAmount);
  if (!Number.isFinite(dollars) || dollars < 0.5) return null;
  return Math.round(dollars * 100);
}

// When a delayed invoice should fire: completedAt + delayDays. delayDays is
// clamped to at least 0. completedAtMs / returns epoch millis so it stays pure
// and testable (no Date.now()).
export function invoiceRunAfterMs(
  completedAtMs: number,
  delayDays: number,
): number {
  const days = Math.max(0, Math.floor(delayDays));
  return completedAtMs + days * 24 * 60 * 60 * 1000;
}
