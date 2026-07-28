import { describe, it, expect } from "vitest";
import {
  buildRepeatingRows,
  attentionFor,
  resumeBlockedReason,
  matchesStatusFilter,
  matchesSearch,
  countsFor,
  sortRows,
  isStatusFilter,
  type RepeatingRow,
} from "./list";

const USERS = new Map([
  ["u-owner", { id: "u-owner", name: "Tyler", role: "owner" as const, deactivated: false }],
  ["u-sarah", { id: "u-sarah", name: "Sarah", role: "staff" as const, deactivated: false }],
  ["u-gone", { id: "u-gone", name: "Marc", role: "staff" as const, deactivated: true }],
]);

const CLIENTS = new Map([
  ["c-1", { id: "c-1", display_name: "Acme Ltd", archived_at: null }],
  ["c-arch", { id: "c-arch", display_name: "Old Corp", archived_at: "2026-01-02" }],
]);

function series(over: Partial<Parameters<typeof buildRepeatingRows>[0]["series"][number]> = {}) {
  return {
    id: "s-1",
    title: "Monthly bookkeeping",
    client_id: "c-1",
    status: "active" as const,
    frequency: "monthly" as const,
    interval_months: null,
    anchor_day: 15,
    due_offset_days: 15,
    next_spawn_on: "2026-08-15",
    paused_at: null,
    ended_at: null,
    items: [{ label: "Bank statement" }, { label: "Receipts" }],
    source_engagement_id: "e-1",
    assigned_user_id: "u-sarah",
    created_by_user_id: "u-owner",
    ...over,
  };
}

const build = (s: ReturnType<typeof series>[]) =>
  buildRepeatingRows({ series: s, clientsById: CLIENTS, usersById: USERS });

describe("buildRepeatingRows", () => {
  it("joins the client name and counts checklist documents", () => {
    const [row] = build([series()]);
    expect(row.clientName).toBe("Acme Ltd");
    expect(row.documentCount).toBe(2);
    expect(row.assigneeName).toBe("Sarah");
    expect(row.attention).toBeNull();
  });

  it("resolves a pre-0940 row through its creator", () => {
    // assigned_user_id absent entirely — the column may not exist yet.
    const [row] = build([series({ assigned_user_id: undefined })]);
    expect(row.assigneeUserId).toBe("u-owner");
    expect(row.assigneeWasRemoved).toBe(false);
  });

  it("shows the EFFECTIVE assignee when the stored one was removed, and flags it", () => {
    // The raw column still says Marc, but Marc is gone — work will actually
    // land on an owner. Rendering the raw value would lie.
    const [row] = build([series({ assigned_user_id: "u-gone" })]);
    expect(row.assigneeUserId).toBe("u-owner");
    expect(row.assigneeName).toBe("Tyler");
    expect(row.assigneeWasRemoved).toBe(true);
    expect(row.attention).toBe("assignee_removed");
  });

  it("still resolves a name for an ARCHIVED client — the flagged row must be readable", () => {
    const [row] = build([series({ client_id: "c-arch" })]);
    expect(row.clientName).toBe("Old Corp");
    expect(row.clientArchived).toBe(true);
    expect(row.attention).toBe("client_archived");
  });

  it("survives a client that isn't in the map at all", () => {
    const [row] = build([series({ client_id: "c-missing" })]);
    expect(row.clientName).toBe("");
    expect(row.clientArchived).toBe(false);
  });

  it("treats a non-array items blob as zero documents rather than throwing", () => {
    const [row] = build([series({ items: null })]);
    expect(row.documentCount).toBe(0);
    expect(row.attention).toBe("empty_checklist");
  });
});

describe("attentionFor", () => {
  const base = {
    status: "active" as const,
    clientArchived: false,
    documentCount: 3,
    assigneeWasRemoved: false,
  };

  it("returns null for a healthy schedule", () => {
    expect(attentionFor(base)).toBeNull();
  });

  it("ranks an archived client above everything else", () => {
    expect(
      attentionFor({ ...base, clientArchived: true, documentCount: 0, assigneeWasRemoved: true }),
    ).toBe("client_archived");
  });

  it("ranks an empty checklist above a removed assignee", () => {
    expect(
      attentionFor({ ...base, documentCount: 0, assigneeWasRemoved: true }),
    ).toBe("empty_checklist");
  });

  it("NEVER flags a stopped schedule — it was stopped on purpose", () => {
    expect(
      attentionFor({
        status: "ended",
        clientArchived: true,
        documentCount: 0,
        assigneeWasRemoved: true,
      }),
    ).toBeNull();
  });

  it("still flags a PAUSED schedule, because pausing is why you'd look", () => {
    expect(attentionFor({ ...base, status: "paused", clientArchived: true })).toBe(
      "client_archived",
    );
  });
});

describe("resumeBlockedReason", () => {
  it("blocks resume when the spawner would just re-pause it", () => {
    expect(resumeBlockedReason({ clientArchived: true, documentCount: 3 })).toBe(
      "client_archived",
    );
    expect(resumeBlockedReason({ clientArchived: false, documentCount: 0 })).toBe(
      "empty_checklist",
    );
  });

  it("allows resume on a healthy paused schedule", () => {
    expect(
      resumeBlockedReason({ clientArchived: false, documentCount: 3 }),
    ).toBeNull();
  });
});

const rows = (): RepeatingRow[] =>
  build([
    series({ id: "a", title: "Zulu", next_spawn_on: "2026-08-20" }),
    series({ id: "b", title: "Alpha", next_spawn_on: "2026-08-12" }),
    series({ id: "c", title: "Flagged", client_id: "c-arch", next_spawn_on: "2026-12-01" }),
    series({ id: "d", title: "Paused one", status: "paused" }),
    series({ id: "e", title: "Stopped one", status: "ended" }),
  ]);

describe("filters and counts", () => {
  it("excludes stopped schedules from EVERY filter", () => {
    for (const f of ["all", "running", "paused", "attention"] as const) {
      const stopped = rows().find((r) => r.id === "e")!;
      expect(matchesStatusFilter(stopped, f)).toBe(false);
    }
  });

  it("counts each bucket, with stopped kept separate", () => {
    expect(countsFor(rows())).toEqual({
      all: 4,
      running: 3,
      paused: 1,
      attention: 1,
      stopped: 1,
    });
  });

  it("validates a status filter from a URL param", () => {
    expect(isStatusFilter("paused")).toBe(true);
    expect(isStatusFilter("nonsense")).toBe(false);
    expect(isStatusFilter(undefined)).toBe(false);
  });
});

describe("sortRows", () => {
  it("floats flagged rows to the top even when their date is furthest away", () => {
    const sorted = sortRows(rows());
    expect(sorted[0].id).toBe("c");
  });

  it("orders running schedules by soonest next run", () => {
    const sorted = sortRows(rows()).filter((r) => r.attention === null);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "d", "e"]);
  });

  it("sorts paused after running, since a paused row has no meaningful date", () => {
    const sorted = sortRows(rows());
    expect(sorted.findIndex((r) => r.id === "d")).toBeGreaterThan(
      sorted.findIndex((r) => r.id === "a"),
    );
  });

  it("does not mutate the input", () => {
    const input = rows();
    const before = input.map((r) => r.id);
    sortRows(input);
    expect(input.map((r) => r.id)).toEqual(before);
  });
});

describe("matchesSearch", () => {
  const row = build([series({ title: "Bookkeeping", client_id: "c-1" })])[0];
  const accented = build([
    series({ title: "Impôts", client_id: "c-acc" }),
  ])[0];

  it("matches the schedule title and the client name", () => {
    expect(matchesSearch(row, "book")).toBe(true);
    expect(matchesSearch(row, "acme")).toBe(true);
    expect(matchesSearch(row, "zzz")).toBe(false);
  });

  it("is accent-insensitive both ways — half this app's names carry accents", () => {
    expect(matchesSearch(accented, "impots")).toBe(true);
    expect(matchesSearch(accented, "impôts")).toBe(true);
  });

  it("treats an empty or whitespace query as matching everything", () => {
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });
});
