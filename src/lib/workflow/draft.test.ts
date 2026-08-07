import { describe, it, expect } from "vitest";
import { parseDraftPayload } from "./draft";
import { flowSendsLetter } from "./plan";

const goodStage = {
  skipped: false,
  assignee: "staff",
  on_entry: ["activate_checklist"],
  tasks: [],
  advance: { condition: "all_docs_verified", mode: "automatic" },
};

function goodPayload() {
  return {
    name: "Monthly bookkeeping",
    summary_en: "Collects, reconciles, bills monthly.",
    summary_fr: "Collecte, concilie, facture chaque mois.",
    send_letter: false,
    stages: {
      collecting: goodStage,
      in_review: {
        skipped: false,
        assignee: "owner",
        on_entry: ["notify_assignee"],
        tasks: [],
        advance: { condition: "manual", mode: "confirm" },
      },
      in_preparation: {
        skipped: false,
        assignee: "staff",
        on_entry: [],
        tasks: [{ title_en: "Reconcile accounts", title_fr: "Concilier les comptes" }],
        advance: { condition: "stage_tasks_done", mode: "automatic" },
      },
      awaiting_signature: { skipped: true, assignee: "none", on_entry: [], tasks: [] },
      awaiting_payment: {
        skipped: false,
        assignee: "none",
        on_entry: ["send_invoice"],
        tasks: [],
        advance: { condition: "invoice_sent", mode: "automatic" },
      },
      completed: { skipped: false, assignee: "none", on_entry: [], tasks: [] },
    },
  };
}

describe("parseDraftPayload", () => {
  it("assembles a well-formed draft into a valid definition", () => {
    const out = parseDraftPayload(goodPayload());
    expect(out).not.toBeNull();
    expect(out!.name).toBe("Monthly bookkeeping");
    expect(out!.definition.stages.awaiting_signature.skipped).toBe(true);
    expect(out!.definition.stages.in_review.assignee).toBe("owner");
    // "none" dialect → null in the stored shape.
    expect(out!.definition.stages.awaiting_payment.assignee).toBeNull();
    expect(flowSendsLetter(out!.definition)).toBe(false);
  });

  it("send_letter true writes the flow-level letter, never a stage action", () => {
    const out = parseDraftPayload({ ...goodPayload(), send_letter: true });
    expect(flowSendsLetter(out!.definition)).toBe(true);
  });

  it("invoice_chase maps snake_case and bounds through the normalizer", () => {
    const out = parseDraftPayload({
      ...goodPayload(),
      invoice_chase: { enabled: true, interval_days: 999, max_reminders: 3 },
    });
    expect(out!.definition.reminders?.invoice).toEqual({
      enabled: true,
      intervalDays: 60,
      maxReminders: 3,
    });
  });

  it("junk degrades: hallucinated actions dropped, garbage stages defaulted, no name = no draft", () => {
    const hallucinated = goodPayload();
    hallucinated.stages.collecting = {
      ...goodStage,
      on_entry: ["activate_checklist", "send_engagement_letter", "delete_firm"],
    } as typeof goodStage;
    const out = parseDraftPayload(hallucinated);
    // The letter is flow-level; a model that sneaks it into a stage gets it
    // dropped by the total parser (it's not in ENTRY... it IS in
    // ENTRY_ACTIONS — but the draft dialect excludes it, and parse keeps
    // known actions only. It stays as a known action here, which
    // withFlowLetter(def, false) then strips.)
    expect(
      out!.definition.stages.collecting.on_entry.includes(
        "send_engagement_letter",
      ),
    ).toBe(false);
    expect(
      out!.definition.stages.collecting.on_entry.includes(
        // @ts-expect-error deliberately checking a non-action
        "delete_firm",
      ),
    ).toBe(false);

    expect(parseDraftPayload({ summary_en: "x", stages: {} })).toBeNull();
    expect(parseDraftPayload("garbage")).toBeNull();
    expect(parseDraftPayload(null)).toBeNull();
  });

  it("a payload with stages missing still yields all six, safely defaulted", () => {
    const out = parseDraftPayload({
      name: "Sparse",
      summary_en: "",
      summary_fr: "",
      send_letter: false,
      stages: { collecting: goodStage },
    });
    expect(out).not.toBeNull();
    expect(Object.keys(out!.definition.stages)).toHaveLength(6);
    expect(out!.definition.stages.completed.skipped).toBe(false);
  });
});

describe("parseDraftPayload — review-pass contracts", () => {
  it("keeps summaries optional and clamps oversized names", () => {
    const out = parseDraftPayload({
      ...goodPayload(),
      name: "x".repeat(500),
      summary_en: 123,
      summary_fr: null,
    });
    expect(out!.name).toHaveLength(120);
    expect(out!.summaryEn).toBe("");
    expect(out!.summaryFr).toBe("");
  });

  it("invoice_chase enabled:false survives as an explicit off", () => {
    const out = parseDraftPayload({
      ...goodPayload(),
      invoice_chase: { enabled: false },
    });
    expect(out!.definition.reminders?.invoice).toEqual({
      enabled: false,
      intervalDays: 7,
      maxReminders: 4,
    });
  });
});
