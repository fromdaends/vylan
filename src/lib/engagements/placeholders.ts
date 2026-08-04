// Dynamic placeholders in an engagement's name.
//
// Canopy's step 1, from the founder's screenshots: the name field reads
// "Monthly Accounting & Advisory Support for {{clientname}}" with a + button
// and the hint "Type "{{" to add dynamic placeholder".
//
// WHY IT MATTERS BEYOND TYPING LESS. An engagement TEMPLATE is reused across
// clients and years, so a literal name in one is wrong for every use after the
// first. A placeholder is what lets a saved template carry a name at all.
//
// PURE: one table, one resolver, no I/O, so the rules are testable and every
// caller resolves identically.

/** What a placeholder can stand for. Everything is optional — a value that is
 *  not known at resolve time leaves its placeholder ALONE rather than blanking
 *  it, so a half-filled form never silently produces "Bookkeeping for ". */
export type PlaceholderValues = {
  clientName?: string | null;
  /** The engagement's tax year, when it has one. */
  taxYear?: number | null;
  /** The firm's own name. */
  firmName?: string | null;
};

/** The tokens offered in the picker, in the order they are shown. */
export const PLACEHOLDERS = [
  "clientname",
  "taxyear",
  "currentyear",
  "currentmonth",
  "firmname",
] as const;

export type PlaceholderToken = (typeof PLACEHOLDERS)[number];

export function placeholderText(token: PlaceholderToken): string {
  return `{{${token}}}`;
}

/**
 * Replace every known placeholder with its value.
 *
 * `now` is injected rather than read from the clock so the date-derived tokens
 * are testable and so a server and a client resolving the same string in the
 * same request cannot disagree across a midnight boundary.
 */
export function resolvePlaceholders(
  text: string,
  values: PlaceholderValues,
  now: Date,
  locale: "en" | "fr" = "en",
): string {
  const resolved: Record<PlaceholderToken, string | null> = {
    clientname: values.clientName?.trim() || null,
    taxyear: values.taxYear != null ? String(values.taxYear) : null,
    currentyear: String(now.getFullYear()),
    currentmonth: new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      month: "long",
    }).format(now),
    firmname: values.firmName?.trim() || null,
  };

  // Case-insensitive and whitespace-tolerant: somebody typing {{ ClientName }}
  // by hand means the same thing, and failing on it would be a puzzle rather
  // than a rule.
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, raw: string) => {
    const key = raw.toLowerCase() as PlaceholderToken;
    if (!(PLACEHOLDERS as readonly string[]).includes(key)) return whole;
    const value = resolved[key];
    // UNKNOWN VALUE LEAVES THE TOKEN. Blanking it would turn "Bookkeeping for
    // {{clientname}}" into "Bookkeeping for " the moment somebody typed a name
    // before picking a client — and that string would then be SAVED.
    return value ?? whole;
  });
}

/** Does this text still contain an unresolved placeholder? */
export function hasUnresolved(text: string): boolean {
  return /\{\{\s*[a-zA-Z]+\s*\}\}/.test(text);
}
