# QuickBooks: per-client connections — plan

Status: **proposed** (awaiting founder sign-off before Phase 1). Build target:
**before Intuit production go-live** (no live firms are connected yet, so there is
zero production migration cost — the cheapest this change will ever be).

## Goal

Move a QuickBooks connection from **one per firm** to **one per client**, so an
accounting firm can post each client's receipts into that client's own QuickBooks
company — the way firms (and QuickBooks Online Accountant) actually work. Today
the "post to QuickBooks" payoff only works for a single client per firm.

## Scoping decision

Scope the connection to the **client** (`clients.id`), not the engagement. A
client business has ONE set of books; a client can have many engagements
(`engagements.client_id`), and they all share that client's QuickBooks. A draft
routes via `engagement.client_id → the client's connection`.

## What stays exactly the same (reused, not rewritten)

The whole posting engine is connection-agnostic and carries over untouched:
payload builders, tax-line logic, matching/suggestions, 3-layer dedup +
idempotency, receipt attachment, the retry/reconnect hardening just shipped
(#797), the approval lifecycle, and the draft queue. We are only changing **which
connection a given engagement routes to**, and **what a cached list is scoped to**.

## Data model changes (one migration)

1. `quickbooks_connections`: add `client_id uuid references clients(id)`. Drop the
   `firm_id UNIQUE`; add `unique (firm_id, client_id)` (one connection per client)
   and keep `realm_id` unique (a QuickBooks company maps to one client). RLS stays
   firm-scoped; add client-scoping to the read policy.
2. Cache tables become client-scoped (each client's QuickBooks has its own
   accounts/vendors/customers/tax codes/items): add `client_id` to the 0420 cache
   tables + `quickbooks_items` (0460) + `quickbooks_learned_mappings` (0490), and
   move their uniqueness/sync-state keys from firm to (firm_id, client_id). Learned
   matching becomes **per client**, which is strictly better (a client's own
   vendor/account memory).
3. Backfill: assign the single existing sandbox connection + its cached rows to a
   chosen sandbox client (or wipe sandbox cache and re-sync). No production rows
   exist.

## Phased rollout (each gated, sandbox-first, adversarially reviewed)

- **Phase 1 — migration + data layer.** Add the columns/keys above; update the DB
  layer (`db/quickbooks.ts`, `db/quickbooks-cache.ts`, `db/quickbooks-learned.ts`)
  to read/write by `(firmId, clientId)`. Degrade gracefully pre-migration. No user
  behavior change yet.
- **Phase 2 — connect flow per client.** The connect action moves from firm-level
  Settings to the client context ("Connect this client's QuickBooks"); OAuth
  `state` carries `clientId`; the callback stores the connection against that
  client. Settings → Integrations shows a LIST of connected clients.
- **Phase 3 — routing.** `getQuickbooksReadContext` / `getValidAccessToken` /
  sync / post all take `clientId` (derived from `engagement.client_id`). The draft
  → engagement → client → connection chain replaces the firm lookup.
- **Phase 4 — UI.** Draft cards, the `/integrations` queue, and the connect
  prompts reflect per-client; the queue can group by client; a draft for a client
  whose QuickBooks isn't connected shows a "connect this client's QuickBooks"
  prompt instead of failing.
- **Phase 5 — verify + cleanup.** Test on sandbox with **two** client companies
  (post to each, confirm isolation). No production migration needed pre-launch.

## Risks / notes

- **Tokens:** N connections per firm instead of one; each refreshes lazily on use
  (the shipped retry/reconnect handling applies per connection). QuickBooks rate
  limits are **per realm**, so more realms = more headroom, not less.
- **Biggest ripple:** re-scoping the cache + learned tables from firm to client;
  everything else is a `firmId → clientId` threading change.
- **Owner-only** connect/disconnect stays; staff-visible read/queue stays.

## Open question for the founder

Confirmed default above is **scope by client**. The only thing that would change
the recommendation is if launch customers are single-entity businesses (one set of
books) rather than multi-client firms — then one-per-firm is temporarily fine.
