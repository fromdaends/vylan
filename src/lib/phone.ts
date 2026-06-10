// E.164 normalization for outbound SMS.
//
// Accountants type phone numbers free-form ("514 555-1234", "(514) 555-1234",
// "+1 514 555 1234") and the clients table stores them as-is. Twilio only
// accepts E.164 ("+15145551234"), so every send normalizes at the edge
// instead of trusting stored data — that also covers numbers saved before
// this helper existed.
//
// Assumption: a bare 10-digit number is Canada/US (+1). Numbers outside the
// NANP must be entered with their country code (e.g. "+33 6 12 34 56 78").

// NANP subscriber numbers: area code and exchange both start with 2–9.
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;

export function normalizeToE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hasPlus) {
    if (digits.startsWith("1")) {
      // "+1…" must carry a full, valid NANP number after the country code.
      return digits.length === 11 && NANP.test(digits.slice(1))
        ? `+${digits}`
        : null;
    }
    // Other countries: enforce E.164 length bounds only.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.length === 10) {
    return NANP.test(digits) ? `+1${digits}` : null;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return NANP.test(digits.slice(1)) ? `+${digits}` : null;
  }
  // Anything else (extensions like "… ext 22", short or garbled input) is
  // safer to skip than to text a number we guessed at.
  return null;
}
