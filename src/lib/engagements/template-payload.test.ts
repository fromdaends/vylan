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
