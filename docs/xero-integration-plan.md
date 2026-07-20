# Xero integration — plan

Status: Phase 1 building (2026-07-19). Mirrors the per-client QuickBooks model
(#806/#816): each client connects their OWN Xero organisation from their client
page; receipts → AI-extracted transaction → draft → accountant approves → post
into that client's books.

Research basis (2026-07-19, verified against developer.xero.com): OAuth
mechanics, token rotation, tenant model, 2026 scope + pricing changes, full
API mapping vs our QBO usage, and a repo reuse audit. Key facts below.

## Platform facts that shape the build

- **OAuth 2.0 auth-code (confidential)**: authorize `https://login.xero.com/identity/connect/authorize`,
  token `https://identity.xero.com/connect/token` (Basic client_id:client_secret).
  Auth code single-use, 5-min expiry. Redirect URIs must be https (plain
  `http://localhost` allowed for dev; `127.0.0.1` rejected).
- **GRANULAR scopes only** (2026 change — the old `accounting.transactions` is
  deprecated, sunset Sep 2027). We request:
  `offline_access accounting.invoices accounting.banktransactions accounting.contacts accounting.settings.read accounting.attachments`.
- **Tokens**: access 30 min; refresh 60 days, SINGLE-USE ROTATING with a 30-min
  grace window. Our QBO fingerprint-based optimistic-concurrency store transfers
  directly. An UNUSED refresh token dies at 60 days → reconnect (keep-alive
  matters more than on QBO's ~100 days).
- **Tenant model**: the org id (`tenantId`) is NOT in the callback — after the
  token exchange, GET `https://api.xero.com/connections` and filter by the
  `authentication_event_id` claim in the access-token JWT to find the org(s)
  just authorized. Every API call needs the `Xero-tenant-id` header. On the
  free/Core tiers one flow connects ONE org (bulk multi-org connect is an
  Advanced-tier feature) — which fits our per-client button exactly.
- **Disconnect**: DELETE `https://api.xero.com/connections/{connectionId}`
  (store connectionId at connect!). Do NOT use token revocation for a
  per-client disconnect — revocation kills ALL of that Xero user's connections.
- **Pricing/limits (2026 model)**: free Starter tier = **5 connections**,
  1,000 calls/day/org. The 6th connection needs a credit card → Core
  ($35 AUD/mo, 50 connections, 5,000 calls/day/org). >50 connections requires
  App Certification (Plus, $245 AUD/mo). Also: an org can connect at most 2
  uncertified apps. Rate limits 60/min/tenant, 5 concurrent, Retry-After on 429.
- **Testing**: free via the **Demo Company** (resets every 28 days → app must be
  reconnected after a reset; test connections count toward the 5-cap until
  removed in the developer portal).
- **Canada**: fully supported; default TaxTypes CAN001–CAN032 (e.g. ON HST on
  Purchases, QC GST/QST as multi-component rates). Read TaxRates per org and
  map by name/rate — never hardcode (same pattern as our QBO tax mapping).
- **T&Cs**: Xero API data must NOT be used to train AI models (we only run
  inference — compliant).

## API mapping (QBO → Xero)

| Our QBO action | Xero equivalent |
| --- | --- |
| Bill (unpaid expense) | POST /Invoices `Type=ACCPAY` (Contact.ContactID + ≥1 LineItem; AUTHORISED needs DueDate) |
| Purchase (paid expense) | POST /BankTransactions `Type=SPEND` (needs a BankAccount of Type BANK; no draft state; tax NOT overridable) |
| Invoice (unpaid income) | POST /Invoices `Type=ACCREC` |
| SalesReceipt (paid income) | POST /BankTransactions `Type=RECEIVE` |
| Accounts/Vendors/Customers/TaxCodes/Items cache | GET /Accounts (full list), /Contacts (paged, UNIFIED vendor+customer list), /TaxRates (full), /Items (full) |
| net + TaxCodeRef tax posting | `LineAmountTypes=Exclusive` + line `TaxType`; Xero computes TaxAmount/TotalTax/Total (response feeds our discrepancy check). ALWAYS set LineAmountTypes — defaults differ per endpoint (Invoices=Exclusive, BankTransactions=Inclusive)! |
| Receipt attach | PUT `/{Endpoint}/{Guid}/Attachments/{filename}` raw bytes, ≤10MB safe limit, ≤10 per doc |
| Idempotent create (requestid) | `Idempotency-Key` header — but keys expire after **6 minutes** (not 24h); retry design must re-check via register match beyond that window. Xero has NO SyncToken. |
| Undo (delete/void) | POST status update: DRAFT/SUBMITTED→DELETED; AUTHORISED→VOIDED (payments must be removed first); BankTransaction→DELETED |
| Register match | `where=` Date range (optimised) + client-side amount compare (no optimised amount filter on BankTransactions); Invoices also has `createdByMyApp=true` |
| company_name/country at connect | GET /Organisation → Name, CountryCode, BaseCurrency, IsDemoCompany |

## Reuse verdicts (repo audit)

- `src/lib/ai/transaction-extract.ts` — **reuse as-is** (schema fully provider-agnostic).
- `src/lib/quickbooks/suggest.ts` (matcher) — **reuse via adapter**, don't fork:
  the Xero read layer emits the same `{accounts, vendors, customers, taxCodes, items}`
  shape; map Xero account Class/Type → the 'expense'/'income'/'bank'/'credit card'
  strings the predicates expect; split unified Contacts into vendors/customers by
  IsSupplier/IsCustomer, putting UN-FLAGGED contacts in BOTH lists (flags only set
  after first transaction); thread a providerLabel for the ~8 stored note strings.
- Draft pure libs (status/resolve/queue/summary) — **reuse unchanged**.
- Drafts table — **provider column** on quickbooks_transaction_suggestions
  (unique-per-file invariant holds: a client connects ONE provider), NOT a
  sibling table. Status/resolve routes shared; only posting branches.
- Connect surface — **clean sibling**: `xero_connections` (client_id NOT NULL
  from day one — no legacy firm-level rows, none of QBO's fallback complexity),
  tenant_id + connection_id instead of realm_id, fingerprint column baked in.
- `token-cipher.ts` — reuse (shared `QBO_TOKEN_ENC_KEY` + envelope; the cipher is
  provider-agnostic).
- `db/xero.ts` needs its OWN isMissingSchema (QBO's regex matches quickbooks_*
  table names only).
- Hub/nav/palette — the 6-touchpoint Sage pattern.
- Worker hook (later): replace the boolean QBO gate in ai/process.ts with
  `resolveBookkeepingProvider(firmId, clientId): 'quickbooks'|'xero'|null`.

## Phases

1. **Connection (NOW)** — migration 0740 `xero_connections`; `src/lib/xero/client.ts`
   (OAuth + fetch wrapper), `src/lib/xero/connection.ts` (token refresh w/
   fingerprint lock), `src/lib/db/xero.ts`; routes
   `/api/integrations/xero/{connect,callback,disconnect}`; `client-xero-card.tsx`
   on the client page; hub card + nav sub-item + palette entry (always visible,
   "Not connected" until linked — founder's rule); i18n; .env.example. NO sync
   enqueue in the callback yet (job kind doesn't exist).
2. **Reference cache + sync** — xero cache tables + `sync_xero` job + read
   adapter emitting the QuickbooksLists shape.
3. **Drafts** — provider column, worker provider resolution, providerLabel in
   suggest, provider prop on the queue/card (swap logo + brand strings).
4. **Posting** — ACCPAY/SPEND/ACCREC/RECEIVE builders, attachments, undo,
   register match (6-min idempotency window → match-before-retry), per-client
   routing (fail-closed client resolution from day one).
5. **Go-live** — founder's Xero app is live immediately (no Intuit-style review
   for basic use); >5 client connections needs the Core tier card-on-file.

## Founder actions (Phase 1)

1. Create a free Xero account (xero.com/signup), then developer.xero.com →
   My Apps → New app: name (must not contain "Xero"), Web app,
   company URL https://vylan.app, redirect URI
   `https://vylan.app/api/integrations/xero/callback`.
2. Copy the Client ID + generate the secret (shown once).
3. Add env vars in Vercel: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`
   (XERO_REDIRECT_URI optional — defaults to APP_URL + callback path).
4. Apply migration 0740 to prod.
5. Activate the Demo Company in My Xero for testing.

## Risks / gotchas carried into the build

- One consent CAN return multiple tenants (authEventId filter; if >1 we take
  the first and store its name — the consent UI on Starter/Core picks one org).
- Same-Xero-user multi-client connects: each connect issues a new token chain
  per row; if Xero invalidates an older chain, the affected client just shows
  "reconnect" (graceful). Verify empirically in founder testing.
- Demo Company 28-day reset = expected reconnects during dev.
- Idempotency 6-min TTL + cached-error replay: never blind-retry a create with
  the same key after a failure; go through register match.
- BankTransactions tax is NOT overridable; LineAmountTypes must be explicit.
- Xero org plan caps (cheapest plan: 20 AR invoices + 5 AP bills/month) can 400
  a post — surface the real message.
