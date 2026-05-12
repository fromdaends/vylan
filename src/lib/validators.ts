// RFC 5321 caps the local part at 64 and the domain at 255 (with a hard
// 254-octet limit on the full address path). We use a tighter character
// allowlist than RFC 5322 to refuse anything that could be used for header
// injection (CR/LF, semicolons, quotes) once these values get fed to a
// mailer.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_EMAIL_LEN = 254;
const MAX_EMAILS = 100;

export function parseEmailList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_EMAIL_LEN)
    .filter((s) => EMAIL_RE.test(s))
    .slice(0, MAX_EMAILS);
}
