# Pre-launch checklist

Things that need to be done before Relai goes live to paying customers.
Each item explains the WHY in plain English so you remember why it
matters. Tick the box when done; leave a note if you skipped on
purpose.

## Notifications

- [ ] **Twilio for SMS retries** — required so the auto-reject feature
  can text clients when their upload is unreadable. Without it,
  clients only get an email retry (which still works, but SMS gets
  much higher response rates from non-tech-savvy clients).
  - Sign up at https://twilio.com/
  - Buy a phone number (Canada A2P 10DLC requires regulatory
    paperwork — start the application early; can take a few days to
    a week to get approved).
  - Add three env vars to Vercel: `TWILIO_ACCOUNT_SID`,
    `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
  - Redeploy.
  - Test by toggling auto-reject on, then having a test client
    upload a deliberately bad photo from a phone — they should get
    both an email AND an SMS.

## (Add more items as you go)

- [ ]
