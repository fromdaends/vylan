// Small redaction helpers for dev-mode console logs. When Resend or
// Twilio is unconfigured, the helpers log "would send to ${recipient}"
// — useful for local dev, but the recipient is client PII and we don't
// want it landing verbatim in Vercel/Sentry/etc. when prod is briefly
// misconfigured. Same pattern Stripe uses for PII in logs.

export function redactEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  return `${local[0]}***${domain}`;
}

export function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  // Preserve only the last 4 digits. Country code is dropped — knowing
  // "this was a French number" is itself a small linkability signal we
  // don't need for log spelunking.
  return `+***-***-${digits.slice(-4)}`;
}
