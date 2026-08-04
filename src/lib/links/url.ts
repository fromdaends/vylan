// Turning what somebody typed into a link that is safe to render as an href.
//
// Pure and framework-free so it can be tested directly. The rule: http(s) URLs
// only — "stripe.com" is helped along to "https://stripe.com", and anything
// whose scheme is not http/https (javascript:, data:, file:) is rejected
// outright, because a stored URL is rendered as <a href> for every member of
// the firm and must never be able to run script.

const MAX_URL_LENGTH = 2048;

export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  // A bare "cra.gc.ca" has no scheme; give it https. A scheme is only a real
  // scheme when it appears before any slash, so "localhost:3000/x" gets helped
  // too while "https://x" is left alone.
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // A URL with no host ("https://") parses but links nowhere.
  if (!parsed.hostname) return null;
  return parsed.toString();
}
