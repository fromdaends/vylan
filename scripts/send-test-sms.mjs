#!/usr/bin/env node
//
// Send yourself a test SMS through the exact same Twilio account the app
// uses, to confirm the credentials in .env.local actually work — without
// waiting days for a real reminder job to fire.
//
// Usage:
//   node --env-file=.env.local scripts/send-test-sms.mjs 514-555-1234
//   node --env-file=.env.local scripts/send-test-sms.mjs +15145551234
//
// Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER from the
// env file. Exits non-zero with a plain-English explanation on any failure.

import twilio from "twilio";

const rawTo = process.argv[2];
if (!rawTo) {
  console.error("Missing phone number.");
  console.error("Usage: node --env-file=.env.local scripts/send-test-sms.mjs 514-555-1234");
  process.exit(1);
}

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM_NUMBER;

if (!sid || !token || !from) {
  console.error("Twilio is not configured yet.");
  console.error("Open .env.local and fill in these three lines, then re-run:");
  console.error("  TWILIO_ACCOUNT_SID=   (starts with AC, from console.twilio.com)");
  console.error("  TWILIO_AUTH_TOKEN=    (next to the SID on the same page)");
  console.error("  TWILIO_FROM_NUMBER=   (your Twilio phone number, like +15145551234)");
  process.exit(1);
}

// Same normalization the app applies at send time — keep in sync with
// src/lib/phone.ts (inlined here because .mjs scripts can't import TS).
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;
function normalizeToE164(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) {
    if (digits.startsWith("1")) {
      return digits.length === 11 && NANP.test(digits.slice(1)) ? `+${digits}` : null;
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return NANP.test(digits) ? `+1${digits}` : null;
  if (digits.length === 11 && digits.startsWith("1")) {
    return NANP.test(digits.slice(1)) ? `+${digits}` : null;
  }
  return null;
}

const to = normalizeToE164(rawTo);
if (!to) {
  console.error(`"${rawTo}" doesn't look like a valid phone number.`);
  console.error("Use a 10-digit Canadian/US number (514-555-1234) or full international format (+15145551234).");
  process.exit(1);
}

console.log(`Sending test SMS from ${from} to ${to} ...`);
try {
  const msg = await twilio(sid, token).messages.create({
    to,
    from,
    body: "Test message — your SMS setup works. (Sent by send-test-sms.mjs)",
  });
  console.log(`Accepted by Twilio. Message id: ${msg.sid}, status: ${msg.status}`);
  console.log("It should arrive within a minute.");
  console.log("If it doesn't, check the delivery log: https://console.twilio.com/us1/monitor/logs/sms");
} catch (e) {
  console.error("Twilio rejected the send:", e.message);
  if (e.code === 21608) {
    console.error("→ Your Twilio account is still in TRIAL mode: it can only text numbers you've verified.");
    console.error("  Either verify your own number at https://console.twilio.com/us1/develop/phone-numbers/manage/verified");
    console.error("  or upgrade the account (add a payment method) to text anyone.");
  }
  if (e.code === 21211) {
    console.error("→ Twilio says the destination number is invalid. Double-check the digits.");
  }
  process.exit(1);
}
