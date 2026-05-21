# Launch Checklist

A running list of everything that needs to happen between now and the
moment a real accounting firm can sign up and use Vylan. I add to this
as we find more during phase work — review before going live.

## External services to sign up for

- [ ] **Resend** — transactional email
  - Sign up: <https://resend.com> (free tier: 3000 emails/month)
  - Verify a sending domain (e.g. `vylan.app`) with SPF + DKIM DNS records
  - Paste `RESEND_API_KEY` and `RESEND_FROM_EMAIL` into `.env.local` (dev) and Vercel env vars (prod)
- [ ] **Twilio** — SMS reminders
  - Sign up: <https://www.twilio.com> (pay-as-you-go; ~$1/mo for a Canadian number)
  - Buy a Canadian number with SMS capability
  - Paste `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- [x] **Anthropic** — Claude API for document classification (Phase 8)
  - Sign up: <https://console.anthropic.com>
  - Paste `ANTHROPIC_API_KEY`  *(done in dev — copy to Vercel before launch)*
- [ ] **Stripe** — billing (Phase 10)
  - In test mode, create **three monthly recurring CAD prices** for Solo / Cabinet / Cabinet+ ($29 / $79 / $149)
  - Copy the price IDs into `.env.local` as `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_CABINET`, `STRIPE_PRICE_CABINET_PLUS`
  - Paste `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
  - Use Stripe CLI for local webhook testing: `stripe listen --forward-to localhost:3000/api/billing/webhook`
  - Switch to live keys + production webhook endpoint before launch
- [ ] **Domain registrar** — buy `vylan.app` (or final name) when naming locks in
- [ ] **Supabase Cloud project** — create in `ca-central-1` region for Quebec Law 25 data residency

## Production deployment

- [ ] Deploy to Vercel
- [ ] Connect Vercel → Supabase Cloud project
- [ ] Push migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`
- [ ] Set every env var from `.env.example` in Vercel project settings
- [ ] Replace placeholder `CRON_SECRET` in `.env.local` with a real 32-char random string and copy to Vercel
- [ ] Set `APP_URL` to the production domain (not `localhost:3000`)
- [ ] Verify Vercel Cron is firing `/api/cron/process-jobs` every 15 min in production
- [ ] Configure Supabase auth `site_url` + `additional_redirect_urls` for the prod domain

## Code / behavior to revisit

- [ ] **Enable email confirmation in Supabase Auth** before public signup — currently disabled per Phase 2 decision
- [ ] **Wire up real teammate invites** — Phase 2 only stubbed them
- [ ] **Replace local CRON_SECRET placeholder** — currently `"replace-me-with-a-32-char-random-string"` in `.env.local`
- [ ] **Fix system npm cache permissions** — run `sudo chown -R 501:20 ~/.npm` once to remove the project-local `.npmrc` workaround
- [ ] **HEIC originals**: decide whether to keep them alongside the JPEG copy (currently only JPEG is stored)
- [ ] **Storage cleanup job**: when a request_item is deleted, its uploaded_files rows cascade-delete but the storage objects are orphaned
- [ ] **Job-claim atomicity** in `/api/cron/process-jobs`: switch to `select … for update skip locked` if reminder volume justifies it
- [ ] **Bulk-approve** items in one click (Phase 9 polish)
- [ ] **Activity timeline pagination** beyond the 100-most-recent entries
- [ ] **Test every flow in English** (most exploration so far has been in French)
- [ ] **Re-check `completeEngagement`** — currently doesn't verify all required items are approved; decide whether to enforce
- [ ] **Reject-reason locale**: the accountant types it in FR, the client sees that exact string regardless of their locale. Decide if we want a translation pass.

## Legal + compliance

- [ ] **Privacy policy** that addresses **Quebec Law 25** + **PIPEDA**
  - [x] Template generated at `/privacy` with DRAFT banner
  - [ ] Lawyer review + remove the DRAFT banner before launch
- [ ] **Terms of service**
  - [x] Template generated at `/terms` with DRAFT banner
  - [ ] Lawyer review + remove the DRAFT banner before launch
- [ ] **Data Processing Addendum** ready for firms that ask
- [ ] **Confirm Supabase region is Canadian** in the project settings
- [ ] **Breach notification procedure** documented (Law 25 requires it)
- [ ] **Cookies / tracking notice** if we add analytics

## Pre-launch testing

- [ ] Run through the full happy path **as a brand-new firm** end-to-end (signup → onboarding → invite client → client uploads → approve → mark complete) in one sitting
- [ ] Same flow in English
- [ ] Test the magic link on **iPhone Safari** and **Android Chrome**
- [ ] Test a real HEIC upload from an iPhone
- [ ] Test what happens when an expired magic link is hit (90 days)
- [ ] Confirm RLS by trying to query another firm's data from a logged-in account (should return empty)
- [ ] Confirm Vercel Cron is actually firing in prod (check the activity_log entries on a paused-then-resumed engagement)
- [ ] Verify emails actually land in Gmail, Outlook, and iCloud inboxes (not spam folders) — DKIM/SPF affects this

## Marketing / launch

- [ ] Landing page copy reviewed by a real Quebec accountant
- [ ] Pricing page with the 3 tiers (Phase 10)
- [ ] Onboarding email sequence (Phase 10: Day 0/1/3/7)
- [ ] One short demo video / Loom for the marketing site
- [ ] Status page or fallback message for downtime
- [ ] Backup / data-export plan for early customers

---

Add to this list when something surfaces during phase work — better to write
it down than try to remember.
