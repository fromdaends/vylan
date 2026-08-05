// Reading a stored engagement template.
//
// The payload is jsonb, so the database validates nothing. Everything here is
// about the one rule that matters: a template saved by today's builder will be
// read by a LATER builder with more steps, and a template saved by a later
// builder may be read by an OLDER deployment mid-rollout. Reading is therefore
// total — a template that half-loads is worth far more than one that throws.

import { describe, expect, it } from "vitest";
import {
  emptyPayload,
  isWorthSaving,
  readPayload,
} from "./template-payload";

describe("readPayload — never throws", () => {
  it("survives anything that is not an object", () => {
    for (const junk of [null, undefined, 42, "nope", [], true]) {
      expect(readPayload(junk)).toEqual(emptyPayload());
    }
  });

  it("ignores fields it does not recognise", () => {
    // A template written by a LATER builder, read by this one. The steps it
    // does not know about must not stop the ones it does from loading.
    const p = readPayload({
      title: "Monthly bookkeeping",
      terms: { general: "..." },
      tasks: [{ template: "x" }],
    });
    expect(p.title).toBe("Monthly bookkeeping");
    expect(p.items).toEqual([]);
  });

  it("keeps the opaque steps as-is without inspecting them", () => {
    const p = readPayload({
      invoice: { mode: "on_completion", amountCents: 50_000 },
      reminders: { preset: "firm" },
    });
    expect(p.invoice).toEqual({ mode: "on_completion", amountCents: 50_000 });
    expect(p.reminders).toEqual({ preset: "firm" });
  });
});

describe("readPayload — priced items", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    name: "Bookkeeping",
    rateCents: 125_000,
    rateType: "item",
    billingFrequency: "monthly",
    taxPct: 13,
    ...over,
  });

  it("reads a well-formed line", () => {
    const [i] = readPayload({ items: [item()] }).items;
    expect(i).toEqual({
      name: "Bookkeeping",
      serviceId: null,
      description: null,
      rateCents: 125_000,
      rateType: "item",
      billingFrequency: "monthly",
      taxPct: 13,
    });
  });

  it("drops a nameless line rather than resurrecting a blank row", () => {
    expect(readPayload({ items: [item({ name: "  " })] }).items).toEqual([]);
    expect(readPayload({ items: [null, 7, "x"] }).items).toEqual([]);
  });

  it("does NOT carry provenance into a template", () => {
    // A template is a shape of work, not an instance of a service — and the
    // catalogue entry it came from may since have been retired.
    const [i] = readPayload({ items: [item({ serviceId: "abc" })] }).items;
    expect(i.serviceId).toBeNull();
  });

  it("falls back on an unknown rate type or frequency", () => {
    const [i] = readPayload({
      items: [item({ rateType: "furlong", billingFrequency: "fortnightly" })],
    }).items;
    expect(i.rateType).toBe("item");
    expect(i.billingFrequency).toBe("once");
  });

  it("refuses a non-integer rate rather than guessing", () => {
    // A fractional cent means something wrote this without respecting the cents
    // rule. "Not priced yet" is safer than inventing a rounding.
    for (const bad of [1250.5, "1250", NaN, null]) {
      expect(readPayload({ items: [item({ rateCents: bad })] }).items[0].rateCents)
        .toBeNull();
    }
  });

  it("keeps an explicit zero, which is a decision", () => {
    expect(readPayload({ items: [item({ rateCents: 0 })] }).items[0].rateCents)
      .toBe(0);
  });
});

describe("readPayload — the document checklist", () => {
  it("mirrors a label when only one language was filled", () => {
    // The builder lets you write either language. Leaving the other blank would
    // show a client an empty row in their own portal language.
    const [a] = readPayload({
      checklist: [{ label_en: "Bank statements", label_fr: "" }],
    }).checklist;
    expect(a.label_fr).toBe("Bank statements");

    const [b] = readPayload({
      checklist: [{ label_en: "", label_fr: "Relevés bancaires" }],
    }).checklist;
    expect(b.label_en).toBe("Relevés bancaires");
  });

  it("drops a row with no label in either language", () => {
    expect(readPayload({ checklist: [{ label_en: " ", label_fr: "" }] }).checklist)
      .toEqual([]);
  });

  it("treats required as strictly boolean true", () => {
    // "true" the string, or 1, is a payload written by something careless —
    // defaulting those to REQUIRED would block a client from finishing.
    for (const v of ["true", 1, {}, null, undefined]) {
      expect(
        readPayload({ checklist: [{ label_en: "X", required: v }] }).checklist[0]
          .required,
      ).toBe(false);
    }
    expect(
      readPayload({ checklist: [{ label_en: "X", required: true }] }).checklist[0]
        .required,
    ).toBe(true);
  });
});

describe("isWorthSaving", () => {
  it("refuses an empty template", () => {
    // It would sit in the picker forever offering an empty engagement, which is
    // what "Create from scratch" already does.
    expect(isWorthSaving(emptyPayload())).toBe(false);
  });

  it("accepts a template carrying any one thing", () => {
    expect(isWorthSaving({ ...emptyPayload(), title: "T1 season" })).toBe(true);
    expect(
      isWorthSaving({
        ...emptyPayload(),
        checklist: [
          {
            label_en: "X",
            label_fr: "X",
            description_en: null,
            description_fr: null,
            doc_type: null,
            required: false,
          },
        ],
      }),
    ).toBe(true);
    expect(
      isWorthSaving({ ...emptyPayload(), invoice: { mode: "now" } }),
    ).toBe(true);
  });
});

describe("readPayload — Canopy's engagement period", () => {
  it("defaults to acceptance when nothing is stored", () => {
    expect(readPayload({}).periodStartsOn).toBe("acceptance");
  });

  it("keeps a custom start rule", () => {
    expect(readPayload({ periodStartsOn: "custom" }).periodStartsOn).toBe(
      "custom",
    );
  });

  it("treats anything unrecognised as acceptance, not custom", () => {
    // The safe default: a template whose start rule failed to read should begin
    // when the client agrees, not on a date nobody chose.
    expect(readPayload({ periodStartsOn: "whenever" }).periodStartsOn).toBe(
      "acceptance",
    );
    expect(readPayload({ periodStartsOn: 7 }).periodStartsOn).toBe("acceptance");
  });

  it("keeps a whole number of months", () => {
    expect(readPayload({ periodMonths: 12 }).periodMonths).toBe(12);
  });

  it("null is Ongoing, and is the default", () => {
    expect(readPayload({}).periodMonths).toBeNull();
    expect(readPayload({ periodMonths: null }).periodMonths).toBeNull();
  });

  it("refuses a fractional, zero or negative period", () => {
    expect(readPayload({ periodMonths: 1.5 }).periodMonths).toBeNull();
    expect(readPayload({ periodMonths: 0 }).periodMonths).toBeNull();
    expect(readPayload({ periodMonths: -3 }).periodMonths).toBeNull();
  });

  it("refuses an absurd period — past ten years it IS ongoing", () => {
    expect(readPayload({ periodMonths: 121 }).periodMonths).toBeNull();
    expect(readPayload({ periodMonths: 120 }).periodMonths).toBe(120);
  });

  it("refuses a stringified number", () => {
    expect(readPayload({ periodMonths: "12" }).periodMonths).toBeNull();
  });

  it("carries the intro message, and defaults it to empty", () => {
    expect(readPayload({ introMessage: "Welcome" }).introMessage).toBe(
      "Welcome",
    );
    expect(readPayload({}).introMessage).toBe("");
    expect(readPayload({ introMessage: 42 }).introMessage).toBe("");
  });
});

describe("readPayload — Canopy's Introduction rows", () => {
  it("all three toggles default off", () => {
    const p = readPayload({});
    expect(p.welcomeEnabled).toBe(false);
    expect(p.videoEnabled).toBe(false);
    expect(p.documentEnabled).toBe(false);
  });

  it("only literal true turns a row on", () => {
    expect(readPayload({ videoEnabled: "true" }).videoEnabled).toBe(false);
    expect(readPayload({ videoEnabled: 1 }).videoEnabled).toBe(false);
    expect(readPayload({ videoEnabled: true }).videoEnabled).toBe(true);
  });

  it("keeps the video link even while the row is off", () => {
    // Turning a row off must not lose what you already pasted — that is the
    // difference between a toggle and a delete.
    const p = readPayload({ videoEnabled: false, videoUrl: "https://vimeo/1" });
    expect(p.videoEnabled).toBe(false);
    expect(p.videoUrl).toBe("https://vimeo/1");
  });

  it("treats a non-string link as absent", () => {
    expect(readPayload({ videoUrl: 42 }).videoUrl).toBe("");
  });
});

describe("readPayload — assignees", () => {
  it("defaults to nobody", () => {
    expect(readPayload({}).assigneeIds).toEqual([]);
  });

  it("keeps order and drops duplicates", () => {
    expect(readPayload({ assigneeIds: ["a", "b", "a"] }).assigneeIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops non-strings and blanks rather than writing them to a uuid column", () => {
    expect(
      readPayload({ assigneeIds: ["a", 7, null, "", "b"] }).assigneeIds,
    ).toEqual(["a", "b"]);
  });

  it("survives assigneeIds not being an array", () => {
    expect(readPayload({ assigneeIds: "nope" }).assigneeIds).toEqual([]);
  });
});

describe("readPayload — Terms and Signatures", () => {
  it("terms default off and empty", () => {
    const p = readPayload({});
    expect(p.termsEnabled).toBe(false);
    expect(p.termsText).toBe("");
  });

  it("keeps the terms text with the toggle off", () => {
    const p = readPayload({ termsEnabled: false, termsText: "Our terms" });
    expect(p.termsText).toBe("Our terms");
  });

  it("deposit defaults to not required and not set", () => {
    const p = readPayload({});
    expect(p.depositRequired).toBe(false);
    expect(p.depositCents).toBeNull();
  });

  it("keeps whole cents", () => {
    expect(readPayload({ depositCents: 50000 }).depositCents).toBe(50000);
  });

  it("null is NOT zero — a deposit of nothing is not a deposit of $0", () => {
    expect(readPayload({}).depositCents).toBeNull();
    expect(readPayload({ depositCents: 0 }).depositCents).toBe(0);
  });

  it("refuses fractional, negative and stringified cents", () => {
    expect(readPayload({ depositCents: 10.5 }).depositCents).toBeNull();
    expect(readPayload({ depositCents: -100 }).depositCents).toBeNull();
    expect(readPayload({ depositCents: "5000" }).depositCents).toBeNull();
  });
});

describe("readPayload — the draft flag", () => {
  it("defaults to finished, not draft", () => {
    expect(readPayload({}).isDraft).toBe(false);
  });

  it("only literal true is a draft", () => {
    // The safe direction: a draft treated as finished is one somebody sends to
    // a client half-written.
    expect(readPayload({ isDraft: "true" }).isDraft).toBe(false);
    expect(readPayload({ isDraft: 1 }).isDraft).toBe(false);
    expect(readPayload({ isDraft: true }).isDraft).toBe(true);
  });
});

describe("readPayload — who signs", () => {
  it("the client signs by default, including on templates written before the field existed", () => {
    // The safe direction: an engagement letter nobody signs would only be
    // discovered once the paperwork was already out.
    expect(readPayload({}).clientSigns).toBe(true);
    expect(readPayload({ title: "x" }).clientSigns).toBe(true);
  });

  it("only literal false turns the client's signature off", () => {
    expect(readPayload({ clientSigns: false }).clientSigns).toBe(false);
    expect(readPayload({ clientSigns: "false" }).clientSigns).toBe(true);
    expect(readPayload({ clientSigns: 0 }).clientSigns).toBe(true);
  });

  it("keeps extra signer slots as labels, trimmed", () => {
    const p = readPayload({ additionalSignerLabels: ["  Spouse  ", "Director"] });
    expect(p.additionalSignerLabels).toEqual(["Spouse", "Director"]);
  });

  it("drops blank and non-string slots", () => {
    const p = readPayload({ additionalSignerLabels: ["Spouse", "  ", 7, null] });
    expect(p.additionalSignerLabels).toEqual(["Spouse"]);
  });

  it("caps the slots rather than storing an unbounded list", () => {
    const many = Array.from({ length: 25 }, (_, i) => `Signer ${i}`);
    expect(readPayload({ additionalSignerLabels: many }).additionalSignerLabels)
      .toHaveLength(10);
  });

  it("survives the slots not being an array", () => {
    expect(readPayload({ additionalSignerLabels: "nope" }).additionalSignerLabels)
      .toEqual([]);
  });

  it("the firm does not counter-sign unless it says so", () => {
    expect(readPayload({}).firmCountersigns).toBe(false);
    expect(readPayload({ firmCountersigns: true }).firmCountersigns).toBe(true);
    expect(readPayload({ firmCountersigns: "yes" }).firmCountersigns).toBe(false);
  });
});

describe("readPayload — billing blocks", () => {
  it("defaults to none, which reads as 'the flat list is all there is'", () => {
    expect(readPayload({}).billingBlocks).toEqual([]);
  });

  it("survives billingBlocks not being an array", () => {
    expect(readPayload({ billingBlocks: "nope" }).billingBlocks).toEqual([]);
  });

  it("drops non-object entries", () => {
    const p = readPayload({ billingBlocks: [null, 7, { billingType: "recurring" }] });
    expect(p.billingBlocks).toHaveLength(1);
  });

  it("keeps a valid type and timing pair", () => {
    const p = readPayload({
      billingBlocks: [{ billingType: "one_time", timing: "on_completion" }],
    });
    expect(p.billingBlocks[0].billingType).toBe("one_time");
    expect(p.billingBlocks[0].timing).toBe("on_completion");
  });

  it("REPAIRS a timing that does not belong to the type rather than dropping the block", () => {
    // Losing the block loses its services; a visibly-wrong rule can be fixed.
    const p = readPayload({
      billingBlocks: [{ billingType: "recurring", timing: "on_completion" }],
    });
    expect(p.billingBlocks[0].timing).toBe("engagement_start");
  });

  it("falls back to one-time for an unrecognised type", () => {
    const p = readPayload({ billingBlocks: [{ billingType: "quarterly_ish" }] });
    expect(p.billingBlocks[0].billingType).toBe("one_time");
    expect(p.billingBlocks[0].timing).toBe("on_acceptance");
  });

  it("falls back to monthly for an unrecognised frequency", () => {
    const p = readPayload({
      billingBlocks: [{ billingType: "recurring", frequency: "fortnightly" }],
    });
    expect(p.billingBlocks[0].frequency).toBe("monthly");
  });

  it("never accepts 'once' as a block frequency", () => {
    // A block that bills once is a one-time block; two ways to say it could
    // then disagree.
    const p = readPayload({
      billingBlocks: [{ billingType: "recurring", frequency: "once" }],
    });
    expect(p.billingBlocks[0].frequency).toBe("monthly");
  });

  it("only literal true combines items", () => {
    expect(
      readPayload({ billingBlocks: [{ combineItems: "true" }] }).billingBlocks[0]
        .combineItems,
    ).toBe(false);
  });

  it("reads the services inside a block", () => {
    const p = readPayload({
      billingBlocks: [
        { billingType: "one_time", items: [{ name: "Setup", rateCents: 50000 }] },
      ],
    });
    expect(p.billingBlocks[0].items).toHaveLength(1);
    expect(p.billingBlocks[0].items[0].name).toBe("Setup");
  });
});

describe("readPayload — price visibility", () => {
  it("shows everything when absent", () => {
    expect(readPayload({}).priceVisibility).toEqual({
      itemizedPrice: true,
      blockTotals: true,
      total: true,
    });
  });

  it("only literal false hides something", () => {
    const p = readPayload({
      priceVisibility: { itemizedPrice: false, blockTotals: "false", total: 0 },
    });
    expect(p.priceVisibility.itemizedPrice).toBe(false);
    expect(p.priceVisibility.blockTotals).toBe(true);
    expect(p.priceVisibility.total).toBe(true);
  });

  it("survives priceVisibility being the wrong type", () => {
    expect(readPayload({ priceVisibility: "nope" }).priceVisibility.total).toBe(true);
  });
});

describe("readPayload — the work a template implies (1620)", () => {
  it("is empty on a template written before the link existed", () => {
    // Every template already in the database. It must read as "no work", not
    // throw and not guess.
    expect(readPayload({}).taskTemplateIds).toEqual([]);
  });

  it("keeps ids, drops anything that is not one, and de-duplicates", () => {
    // A template that named the same work twice would create it twice on every
    // engagement made from it.
    const p = readPayload({
      taskTemplateIds: ["a", "a", "  b  ", "", 7, null, "c"],
    });
    expect(p.taskTemplateIds).toEqual(["a", "b", "c"]);
  });

  it("caps the list", () => {
    const p = readPayload({
      taskTemplateIds: Array.from({ length: 80 }, (_, i) => `t${i}`),
    });
    expect(p.taskTemplateIds).toHaveLength(50);
  });

  it("survives the field being the wrong type entirely", () => {
    expect(readPayload({ taskTemplateIds: "nope" }).taskTemplateIds).toEqual([]);
    expect(readPayload({ taskTemplateIds: 42 }).taskTemplateIds).toEqual([]);
  });

  it("work alone makes a template worth saving", () => {
    // A template whose only content is "these six tasks" is a perfectly good
    // template — it is what a service-led firm reaches for.
    const p = readPayload({ taskTemplateIds: ["a"] });
    expect(isWorthSaving(p)).toBe(true);
    expect(isWorthSaving(readPayload({}))).toBe(false);
  });
});
