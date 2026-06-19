// Pure helper: pick the amount (in cents) to pre-fill the Request-payment
// dialog. Priority:
//   1. The firm's per-service default price for this engagement type, if set.
//   2. Otherwise the firm's most recent payment amount ("remember last amount").
//   3. Otherwise null (empty field).
// Kept pure + dependency-free so it's trivially testable and shared by the page.

export function resolveDefaultAmountCents(
  servicePrices: Record<string, number> | null | undefined,
  engagementType: string,
  lastAmountCents: number | null | undefined,
): number | null {
  const perService = servicePrices?.[engagementType];
  if (typeof perService === "number" && Number.isFinite(perService) && perService > 0) {
    return Math.round(perService);
  }
  if (
    typeof lastAmountCents === "number" &&
    Number.isFinite(lastAmountCents) &&
    lastAmountCents > 0
  ) {
    return Math.round(lastAmountCents);
  }
  return null;
}
