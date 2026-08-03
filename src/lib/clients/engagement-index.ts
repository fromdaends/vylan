import type {
  ClientEngagementSummary,
  ClientEngagementRow,
} from "@/components/clients/clients-table";
import type { Engagement, EngagementStatus } from "@/lib/db/engagements";

// Everything the clients TABLE needs to know about engagements, in one pass.
//
// PURE (no I/O, no React), so it is unit-tested directly and any page that
// renders ClientsTable feeds it the same way. It was inline on /clients until
// the teammate profile's Clients tab needed the identical three maps — and the
// repo's Cohesion rule is that the second surface gets the same code, not a
// second copy that drifts the first time someone changes how a status counts.
//
// Only a type import from the table component, so this stays importable from a
// Server Component.

// Live = the accountant is actually working on it. Draft is not yet real work
// and complete/cancelled are finished, so neither belongs in the "how busy is
// this client" number the row badge shows.
const LIVE_STATUSES: ReadonlySet<EngagementStatus> = new Set([
  "sent",
  "in_progress",
]);

// Sort order inside a client's expanded drawer: live first (the accountant's
// ball first of all), then drafts, then finished work. ready_to_review is the
// unified display status a live engagement gets when the ball is in the
// accountant's court — it LEADS the list, never trails it.
const STATUS_RANK: Record<string, number> = {
  ready_to_review: 0,
  in_progress: 1,
  sent: 2,
  draft: 3,
  complete: 4,
  cancelled: 5,
};

export type ClientEngagementIndex = {
  /** Per-client status tallies — the row's "Engagements" badge. */
  summaries: Record<string, ClientEngagementSummary>;
  /** Per-client engagement rows — the expanded drawer, with no second fetch. */
  engagementsByClient: Record<string, ClientEngagementRow[]>;
  /** Newest engagement created_at per client — the `most_active` sort. */
  lastActivityByClient: Record<string, string>;
};

export function buildClientEngagementIndex(
  // Expected NEWEST FIRST, which is what listEngagements returns. The order is
  // preserved inside each status bucket, and lastActivityByClient takes the
  // first one it sees per client, so a differently-ordered input would quietly
  // produce a different (wrong) answer for both.
  engagements: Engagement[],
  // The unified display status per engagement id (lib/attention). Anything
  // missing falls back to the raw status, which is what a page that has not
  // loaded signals passes.
  derivedStatusById?: Map<string, EngagementStatus | "ready_to_review">,
): ClientEngagementIndex {
  const summaries: Record<string, ClientEngagementSummary> = {};
  const engagementsByClient: Record<string, ClientEngagementRow[]> = {};
  const lastActivityByClient: Record<string, string> = {};

  for (const e of engagements) {
    const s =
      summaries[e.client_id] ??
      ({
        draft: 0,
        sent: 0,
        in_progress: 0,
        complete: 0,
        cancelled: 0,
        total_live: 0,
      } satisfies ClientEngagementSummary);
    s[e.status] += 1;
    if (LIVE_STATUSES.has(e.status)) s.total_live += 1;
    summaries[e.client_id] = s;

    const list = engagementsByClient[e.client_id] ?? [];
    list.push({
      id: e.id,
      title: e.title,
      type: e.type,
      status: derivedStatusById?.get(e.id) ?? e.status,
      due_date: e.due_date,
    });
    engagementsByClient[e.client_id] = list;

    // First one wins — the input is newest first.
    if (!(e.client_id in lastActivityByClient)) {
      lastActivityByClient[e.client_id] = e.created_at;
    }
  }

  for (const id of Object.keys(engagementsByClient)) {
    engagementsByClient[id].sort(
      (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
    );
  }

  return { summaries, engagementsByClient, lastActivityByClient };
}
