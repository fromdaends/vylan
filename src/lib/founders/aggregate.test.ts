import { describe, expect, it } from "vitest";
import {
  bucketByDay,
  buildFirmRows,
  countBy,
  dayKey,
  filterFirmRows,
  formatCents,
  formatMinutes,
  matchesQuery,
  maxBy,
  relativeAge,
  sinceIso,
  sortFirmRows,
  sumBy,
  type FirmSources,
} from "@/lib/founders/aggregate";

// A fixed instant so every day-bucket assertion is deterministic. Deliberately
// mid-month and mid-year — a January-only test would not catch an off-by-one
// that only shows across a month boundary.
const NOW = Date.parse("2026-08-06T18:30:00.000Z");

describe("countBy / sumBy / maxBy", () => {
  it("counts per key and skips rows with no key", () => {
    expect(
      countBy([{ f: "a" }, { f: "a" }, { f: "b" }, { f: null }], (r) => r.f),
    ).toEqual({ a: 2, b: 1 });
  });

  it("sums per key, treating non-finite values as zero rather than NaN", () => {
    const rows = [
      { f: "a", n: 100 },
      { f: "a", n: Number.NaN },
      { f: "b", n: 5 },
    ];
    expect(sumBy(rows, (r) => r.f, (r) => r.n)).toEqual({ a: 100, b: 5 });
  });

  it("takes the latest timestamp per key", () => {
    const rows = [
      { f: "a", at: "2026-01-01T00:00:00Z" },
      { f: "a", at: "2026-06-01T00:00:00Z" },
      { f: "b", at: "2026-03-01T00:00:00Z" },
      { f: "b", at: null },
    ];
    expect(maxBy(rows, (r) => r.f, (r) => r.at)).toEqual({
      a: "2026-06-01T00:00:00Z",
      b: "2026-03-01T00:00:00Z",
    });
  });
});

describe("dayKey / sinceIso", () => {
  it("reduces an instant to its UTC calendar day", () => {
    expect(dayKey("2026-08-06T23:59:59.000Z")).toBe("2026-08-06");
    expect(dayKey(NOW)).toBe("2026-08-06");
  });

  it("returns an empty string for an unparseable value rather than 'Invalid Date'", () => {
    expect(dayKey("not a date")).toBe("");
  });

  it("walks back whole days", () => {
    expect(sinceIso(NOW, 7)).toBe("2026-07-30T18:30:00.000Z");
  });
});

describe("bucketByDay", () => {
  it("returns a DENSE series ending today, oldest first", () => {
    const out = bucketByDay([], 5, NOW);
    expect(out.map((b) => b.date)).toEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
    ]);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });

  it("counts events onto their own day and leaves the gaps at zero", () => {
    const out = bucketByDay(
      [
        "2026-08-06T01:00:00Z",
        "2026-08-06T22:00:00Z",
        "2026-08-04T12:00:00Z",
        null,
        undefined,
      ],
      3,
      NOW,
    );
    expect(out).toEqual([
      { date: "2026-08-04", count: 1 },
      { date: "2026-08-05", count: 0 },
      { date: "2026-08-06", count: 2 },
    ]);
  });

  it("crosses a month boundary without losing or duplicating a day", () => {
    const out = bucketByDay(["2026-07-31T10:00:00Z"], 8, NOW);
    expect(out).toHaveLength(8);
    expect(out[0].date).toBe("2026-07-30");
    expect(out.find((b) => b.date === "2026-07-31")?.count).toBe(1);
    // No repeats — the bug an hour-based loop produces across a DST change.
    expect(new Set(out.map((b) => b.date)).size).toBe(8);
  });

  it("ignores events outside the window instead of piling them on the edge", () => {
    const out = bucketByDay(["2020-01-01T00:00:00Z"], 3, NOW);
    expect(out.reduce((a, b) => a + b.count, 0)).toBe(0);
  });
});

describe("matchesQuery", () => {
  it("folds accents and case in both directions", () => {
    expect(matchesQuery("Cabinet Tremblay", "tremblay")).toBe(true);
    expect(matchesQuery("Hélène & Co", "helene")).toBe(true);
    expect(matchesQuery("Helene & Co", "hélène")).toBe(true);
  });

  it("is token-based, so word order does not matter", () => {
    expect(matchesQuery("ZT & Associates", "asso zt")).toBe(true);
    expect(matchesQuery("ZT & Associates", "zt nope")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery("anything", "")).toBe(true);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

// ── the assembler ────────────────────────────────────────────────────────────

function sources(over: Partial<FirmSources> = {}): FirmSources {
  const base: FirmSources = {
    firms: [
      {
        id: "f1",
        name: "ZT & Associates",
        plan: "solo",
        is_demo: false,
        is_pilot: null,
        locale_default: "en",
        province: "QC",
        created_at: "2026-01-10T00:00:00Z",
        onboarded_at: "2026-01-11T00:00:00Z",
        trial_ends_at: null,
        subscription_status: "active",
        workflows_enabled: true,
        time_insights_enabled: null,
      },
      {
        id: "f2",
        name: "  ",
        plan: null,
        is_demo: true,
        is_pilot: true,
        locale_default: null,
        province: null,
        created_at: "2026-08-01T00:00:00Z",
        onboarded_at: null,
        trial_ends_at: "2026-08-15T00:00:00Z",
        subscription_status: null,
        workflows_enabled: null,
        time_insights_enabled: true,
      },
    ],
    users: [
      { firm_id: "f1", role: "owner", deactivated_at: null },
      { firm_id: "f1", role: "staff", deactivated_at: null },
      { firm_id: "f1", role: "staff", deactivated_at: "2026-05-01T00:00:00Z" },
    ],
    clients: [
      { firm_id: "f1", archived_at: null },
      { firm_id: "f1", archived_at: "2026-04-01T00:00:00Z" },
    ],
    engagements: [
      { firm_id: "f1", status: "in_progress", deleted_at: null },
      { firm_id: "f1", status: "complete", deleted_at: null },
      { firm_id: "f1", status: "draft", deleted_at: null },
      { firm_id: "f1", status: "sent", deleted_at: "2026-06-01T00:00:00Z" },
    ],
    tasks: [
      { firm_id: "f1", status: "todo" },
      { firm_id: "f1", status: "done" },
    ],
    documents: [{ firm_id: "f1" }, { firm_id: "f1" }, { firm_id: "f1" }],
    invoices: [
      { firm_id: "f1", amount_cents: 125000, status: "paid" },
      { firm_id: "f1", amount_cents: 50000, status: "requested" },
    ],
    messages: [{ firm_id: "f1" }],
    assistantMessages: [{ firm_id: "f1" }, { firm_id: "f1" }],
    signatures: [{ firm_id: "f1" }],
    timeEntries: [
      { firm_id: "f1", duration_minutes: 90 },
      { firm_id: "f1", duration_minutes: null },
    ],
    automations: [{ firm_id: "f1" }],
    services: [{ firm_id: "f1" }],
    templates: [{ firm_id: "f1" }],
    integrations: {
      quickbooks: [{ firm_id: "f1" }],
      xero: [],
      storage: [],
      calendar: [],
    },
    aiUsage: [{ firm_id: "f1", used: 42 }],
    events: [
      { firm_id: "f1", created_at: "2026-08-06T10:00:00Z", actor_type: "user" },
      { firm_id: "f1", created_at: "2026-08-05T10:00:00Z", actor_type: "client" },
      { firm_id: "f1", created_at: "2026-07-20T10:00:00Z", actor_type: "system" },
    ],
    ...over,
  };
  return base;
}

describe("buildFirmRows", () => {
  it("produces one row per firm, even for a firm with nothing at all", () => {
    const rows = buildFirmRows(sources(), NOW);
    expect(rows).toHaveLength(2);
    const empty = rows.find((r) => r.id === "f2")!;
    expect(empty.users).toBe(0);
    expect(empty.clients).toBe(0);
    expect(empty.invoicedCents).toBe(0);
    expect(empty.lastActivityAt).toBeNull();
  });

  it("counts people, splitting active from deactivated", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.users).toBe(3);
    expect(f1.activeUsers).toBe(2);
    expect(f1.owners).toBe(1);
  });

  it("EXCLUDES soft-deleted engagements from every engagement count", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.engagements).toBe(3); // the deleted 'sent' one is gone
    expect(f1.activeEngagements).toBe(1);
    expect(f1.completedEngagements).toBe(1);
    expect(f1.draftEngagements).toBe(1);
  });

  it("counts archived clients in the total but not in active", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.clients).toBe(2);
    expect(f1.activeClients).toBe(1);
  });

  it("sums money in cents and counts only PAID toward paid", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.invoices).toBe(2);
    expect(f1.invoicedCents).toBe(175000);
    expect(f1.paidCents).toBe(125000);
  });

  it("treats a null duration as zero minutes, never NaN", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.timeMinutes).toBe(90);
  });

  it("splits the pulse into 7-day and 30-day windows and records the last event", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.events30d).toBe(3);
    expect(f1.events7d).toBe(2); // the 20 July one is outside 7 days
    expect(f1.lastActivityAt).toBe("2026-08-06T10:00:00Z");
  });

  // The number that separates "an accountant is clicking around" from "the
  // product reached the people it is for".
  it("counts CLIENT-actor events separately from the firm's own", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.clientEvents30d).toBe(1);
  });

  it("counts assistant turns and signature requests", () => {
    const f1 = buildFirmRows(sources(), NOW).find((r) => r.id === "f1")!;
    expect(f1.assistantMessages).toBe(2);
    expect(f1.signatures).toBe(1);
  });

  // activity_log rows read before actor_type was selected (or from a source
  // that does not carry it) must not silently become "client".
  it("treats a missing actor_type as not-a-client", () => {
    const rows = buildFirmRows(
      sources({ events: [{ firm_id: "f1", created_at: "2026-08-06T10:00:00Z" }] }),
      NOW,
    );
    expect(rows.find((r) => r.id === "f1")!.clientEvents30d).toBe(0);
  });

  it("names an unnamed firm rather than rendering an unclickable gap", () => {
    const f2 = buildFirmRows(sources(), NOW).find((r) => r.id === "f2")!;
    expect(f2.name).toBe("(unnamed firm)");
  });

  it("reads the optional flags as strict booleans, so an unapplied migration is OFF", () => {
    const rows = buildFirmRows(sources(), NOW);
    const f1 = rows.find((r) => r.id === "f1")!;
    const f2 = rows.find((r) => r.id === "f2")!;
    expect(f1.workflowsEnabled).toBe(true);
    expect(f1.timeInsightsEnabled).toBe(false); // null column ⇒ off
    expect(f1.isPilot).toBe(false);
    expect(f2.isPilot).toBe(true);
    expect(f2.workflowsEnabled).toBe(false);
  });

  it("marks integrations per firm", () => {
    const rows = buildFirmRows(sources(), NOW);
    expect(rows.find((r) => r.id === "f1")!.integrations).toEqual({
      quickbooks: true,
      xero: false,
      storage: false,
      calendar: false,
    });
  });
});

describe("pinning", () => {
  it("marks only the pinned firms", () => {
    const rows = buildFirmRows(sources({ pinnedFirmIds: ["f2"] }), NOW);
    expect(rows.find((r) => r.id === "f1")!.pinned).toBe(false);
    expect(rows.find((r) => r.id === "f2")!.pinned).toBe(true);
  });

  // 1800 unapplied reads exactly like "nothing pinned yet", which is correct:
  // both mean the watchlist is empty as far as a reader is concerned.
  it("treats a missing watchlist as nothing pinned, never as an error", () => {
    expect(buildFirmRows(sources(), NOW).every((r) => !r.pinned)).toBe(true);
    expect(buildFirmRows(sources({ pinnedFirmIds: [] }), NOW).every((r) => !r.pinned)).toBe(true);
  });

  it("ignores a pinned id for a firm that no longer exists", () => {
    const rows = buildFirmRows(sources({ pinnedFirmIds: ["gone"] }), NOW);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.pinned)).toBe(true);
  });
});

describe("sortFirmRows", () => {
  const rows = buildFirmRows(sources(), NOW);

  it("sorts by a number in both directions", () => {
    expect(sortFirmRows(rows, "clients", "desc")[0].id).toBe("f1");
    expect(sortFirmRows(rows, "clients", "asc")[0].id).toBe("f2");
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.id);
    sortFirmRows(rows, "clients", "asc");
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  // A silent firm is "no answer", not "the beginning of time".
  it("puts firms that have NEVER been active last, whichever direction", () => {
    expect(sortFirmRows(rows, "lastActivityAt", "desc").at(-1)!.id).toBe("f2");
    expect(sortFirmRows(rows, "lastActivityAt", "asc").at(-1)!.id).toBe("f2");
  });

  // The whole point of a pin: the firm stays where you left it whichever
  // column you are sorting by, in either direction.
  it("floats pinned firms to the top of EVERY sort and direction", () => {
    const pinned = buildFirmRows(sources({ pinnedFirmIds: ["f2"] }), NOW);
    for (const key of ["clients", "engagements", "events30d", "name", "createdAt"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        expect(sortFirmRows(pinned, key, dir)[0].id).toBe("f2");
      }
    }
  });

  it("still sorts pinned firms among THEMSELVES by the chosen column", () => {
    const both = buildFirmRows(sources({ pinnedFirmIds: ["f1", "f2"] }), NOW);
    expect(sortFirmRows(both, "clients", "desc").map((r) => r.id)).toEqual(["f1", "f2"]);
    expect(sortFirmRows(both, "clients", "asc").map((r) => r.id)).toEqual(["f2", "f1"]);
  });

  it("can be told to ignore pins for a genuinely flat ordering", () => {
    const pinned = buildFirmRows(sources({ pinnedFirmIds: ["f2"] }), NOW);
    expect(sortFirmRows(pinned, "clients", "desc", false)[0].id).toBe("f1");
  });

  it("breaks ties on name so the order is stable between renders", () => {
    const tied = buildFirmRows(
      sources({
        users: [],
        clients: [],
        engagements: [],
        tasks: [],
        documents: [],
        invoices: [],
        messages: [],
        timeEntries: [],
        events: [],
      }),
      NOW,
    );
    expect(sortFirmRows(tied, "clients", "desc").map((r) => r.name)).toEqual([
      "(unnamed firm)",
      "ZT & Associates",
    ]);
  });
});

describe("filterFirmRows", () => {
  const rows = buildFirmRows(sources(), NOW);

  it("finds a firm by a fragment of its name", () => {
    expect(filterFirmRows(rows, "asso").map((r) => r.id)).toEqual(["f1"]);
  });

  it("finds a firm by plan or province", () => {
    expect(filterFirmRows(rows, "solo").map((r) => r.id)).toEqual(["f1"]);
    expect(filterFirmRows(rows, "qc").map((r) => r.id)).toEqual(["f1"]);
  });

  it("returns everything for an empty query, as a copy", () => {
    const out = filterFirmRows(rows, "  ");
    expect(out).toHaveLength(2);
    expect(out).not.toBe(rows);
  });
});

describe("formatting", () => {
  it("renders cents as dollars without inventing precision", () => {
    expect(formatCents(125000)).toContain("1,250");
    expect(formatCents(0)).toContain("0");
  });

  it("renders minutes as hours and minutes, and nothing as an em dash", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(0)).toBe("—");
    expect(formatMinutes(Number.NaN)).toBe("—");
  });

  it("renders a coarse relative age", () => {
    expect(relativeAge("2026-08-06T18:29:30.000Z", NOW)).toBe("just now");
    expect(relativeAge("2026-08-06T17:30:00.000Z", NOW)).toBe("1h ago");
    expect(relativeAge("2026-08-01T18:30:00.000Z", NOW)).toBe("5d ago");
    expect(relativeAge(null, NOW)).toBe("—");
    expect(relativeAge("nonsense", NOW)).toBe("—");
  });
});
