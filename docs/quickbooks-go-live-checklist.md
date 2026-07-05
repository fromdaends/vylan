# QuickBooks go-live checklist

This is the plain-English path to turn the QuickBooks integration from
**sandbox** (test companies) into **production** (real client books). There are
two tracks that run in parallel:

- **Track A — Intuit approval** (your work in the Intuit account; I can't do it for you).
- **Track B — flip the switch** (mostly my code work, already done; a few settings are yours).

Do Track A first (it takes the longest — Intuit reviews it). Track B is quick once A is approved.

---

## Track A — Get Intuit to approve the app for production

You do this in the Intuit Developer dashboard: <https://developer.intuit.com/app/developer/homepage>
→ open your app → the **Production** tab / "Get production credentials".

Intuit makes you complete a checklist before they hand over production keys. Expect:

1. **App details.** App name, logo, a short description, your support email, and your
   host domain (`vylan.app`).
2. **Legal URLs.** A **privacy policy** URL and an **end-user license agreement (EULA)** /
   terms URL, both publicly reachable on vylan.app. If you don't have these pages yet,
   that's the main thing to create. (Tell me and I'll build simple privacy + terms pages.)
3. **Production redirect URI.** Exactly `https://vylan.app/api/integrations/quickbooks/callback`
   (must match character-for-character, https, no trailing slash).
4. **Scopes.** Accounting (`com.intuit.quickbooks.accounting`) — the same one the app
   already requests.
5. **Security questionnaire.** Intuit asks how you protect the connection. The honest,
   good answers you can give:
   - OAuth tokens are **encrypted at rest** (AES-256-GCM) and only readable by the
     server, never by end users. (This is the encryption work I just shipped.)
   - All traffic is HTTPS.
   - Tokens are never logged; access is scoped per firm.
6. **App assessment / questionnaire about data usage** — what data you read (accounting
   lists + you post transactions the accountant approves) and why.
7. **Submit for review.** Intuit reviews it. This can take a few days to a couple of weeks.
   They may come back with questions; answer them and resubmit.

**What I can help with in Track A:** drafting the privacy policy + terms pages, wording
the security answers, and reviewing anything Intuit sends back. Just ask.

---

## Track B — Flip the switch (once Intuit approves)

When Intuit gives you **production keys**, we go live in this exact order. Nothing here
changes anything for real users until the last step.

1. **Apply the token-encryption migration.** ✅ **DONE** — `0480` is applied in
   production (verified 2026-07-05: the `refresh_token_fingerprint` column exists on
   `quickbooks_connections`). Nothing to do here.
2. **Generate the encryption key.** In your terminal, run:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Copy the line it prints. **Save it somewhere safe** (a password manager). If you ever
   lose it, connections just have to reconnect — no data loss, but don't lose it casually.
3. **Add the key to Vercel.** Vercel → your **vylan** project → Settings → Environment
   Variables → add `QBO_TOKEN_ENC_KEY` = the value from step 2 (Production). Save.
4. **Add the production QuickBooks settings** (same Vercel env vars screen):
   - `QBO_ENVIRONMENT` = `production`
   - `QBO_CLIENT_ID` = your **production** client id (from Intuit)
   - `QBO_CLIENT_SECRET` = your **production** client secret (from Intuit)
   - `QBO_REDIRECT_URI` = `https://vylan.app/api/integrations/quickbooks/callback`
5. **Redeploy.** From the project folder: `git commit --allow-empty -m "redeploy" && git push`
   (or click Redeploy in Vercel).
6. **Reconnect.** Sandbox connections don't carry over to production. Each firm (starting
   with you) goes to Settings → Integrations and connects to their **real** QuickBooks
   company. From then on, tokens are stored encrypted.

**Safety notes**
- Steps 1–4 are inert until the redeploy in step 5. You can stage them calmly.
- The `QBO_TAX_LINES_ENABLED` switch is independent — leave it as you have it.
- If anything looks wrong after go-live, set `QBO_ENVIRONMENT` back to `sandbox` and
  redeploy to fall back safely (it fails safe to sandbox unless it says exactly "production").

---

## Quick status

- Token encryption at rest: **done** (ships behind `QBO_TOKEN_ENC_KEY`, off until you set it).
- Migration `0480`: **applied in production** ✅ (verified 2026-07-05).
- The one thing left before encryption is actually live: set `QBO_TOKEN_ENC_KEY` in
  Vercel (Track B, step 3) — do this at go-live, after Intuit approval.
- Everything else in Track B: **ready**, waiting on Intuit approval (Track A).
