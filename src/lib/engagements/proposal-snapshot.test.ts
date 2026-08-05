import { describe, it, expect } from "vitest";
import {
  readProposalSnapshot,
  proposalIsPresentable,
} from "./proposal-snapshot";

const read = (raw: unknown) => readProposalSnapshot(raw, "Acme Inc.");

describe("readProposalSnapshot — total, because a client is looking at it", () => {
  it("survives null, undefined and a bare string", () => {
    for (const raw of [null, undefined, "nonsense", 42]) {
      expect(() => read(raw)).not.toThrow();
    }
  });

  it("always carries the client's CURRENT name, not the snapshot's", () => {
    // A renamed client must still read correctly on their own document.
    expect(read({ clientName: "Old Name Ltd." }).clientName).toBe("Acme Inc.");
  });

  it("an empty snapshot is readable and simply says nothing", () => {
    const p = read({});
    expect(p.engagementName).toBe("");
    expect(p.services).toEqual([]);
    expect(p.terms).toBeNull();
  });
});

describe("readProposalSnapshot — the signature block", () => {
  it("asks the client to sign when the field is missing", () => {
    // A contract with no signature line and no explanation is the worse
    // failure.
    expect(read({}).clientSigns).toBe(true);
  });

  it("only literal false removes the client's signature", () => {
    expect(read({ clientSigns: false }).clientSigns).toBe(false);
    expect(read({ clientSigns: "false" }).clientSigns).toBe(true);
    expect(read({ clientSigns: 0 }).clientSigns).toBe(true);
  });

  it("keeps extra signer roles, trimmed and capped", () => {
    expect(read({ additionalSignerLabels: ["  Spouse  ", 7, ""] })
      .additionalSignerLabels).toEqual(["Spouse"]);
    expect(
      read({ additionalSignerLabels: Array.from({ length: 30 }, (_, i) => `S${i}`) })
        .additionalSignerLabels,
    ).toHaveLength(10);
  });

  it("the firm does not counter-sign unless it says so", () => {
    expect(read({}).firmCountersigns).toBe(false);
    expect(read({ firmCountersigns: true }).firmCountersigns).toBe(true);
  });
});

describe("readProposalSnapshot — money and services", () => {
  it("keeps named services and drops nameless ones", () => {
    const p = read({
      services: [
        { name: "Bookkeeping", rateCents: 50000 },
        { name: "  ", rateCents: 100 },
        null,
      ],
    });
    expect(p.services).toEqual([
      { name: "Bookkeeping", rateCents: 50000, work: [] },
    ]);
  });

  it("an unpriced service is null, never zero — that would offer it free", () => {
    const p = read({ services: [{ name: "Advice", rateCents: "lots" }] });
    expect(p.services[0].rateCents).toBeNull();
  });

  it("carries the work a service buys, trimmed and capped", () => {
    // What the client is actually buying. "Monthly bookkeeping" means nothing
    // until it says which things get done.
    const p = read({
      services: [
        { name: "Bookkeeping", work: ["  Reconcile  ", "", 7, "Close"] },
      ],
    });
    expect(p.services[0].work).toEqual(["Reconcile", "Close"]);

    const many = read({
      services: [
        { name: "Bookkeeping", work: Array.from({ length: 60 }, (_, i) => `S${i}`) },
      ],
    });
    // A snapshot from a newer build must not put sixty lines under one service
    // on somebody's contract.
    expect(many.services[0].work).toHaveLength(25);
  });

  it("a service with no work reads as an empty list, never undefined", () => {
    expect(read({ services: [{ name: "Advice" }] }).services[0].work).toEqual([]);
  });

  it("refuses a fractional or negative deposit", () => {
    expect(read({ depositCents: 10.5 }).depositCents).toBeNull();
    expect(read({ depositCents: -100 }).depositCents).toBeNull();
    expect(read({ depositCents: 50000 }).depositCents).toBe(50000);
  });
});

describe("readProposalSnapshot — the period", () => {
  it("defaults to beginning on acceptance", () => {
    expect(read({}).periodStartsOn).toBe("acceptance");
    expect(read({ periodStartsOn: "whenever" }).periodStartsOn).toBe("acceptance");
  });

  it("keeps a custom start and a whole-month period", () => {
    const p = read({ periodStartsOn: "custom", periodMonths: 12 });
    expect(p.periodStartsOn).toBe("custom");
    expect(p.periodMonths).toBe(12);
  });

  it("a fractional period is Ongoing", () => {
    expect(read({ periodMonths: 1.5 }).periodMonths).toBeNull();
  });
});

describe("proposalIsPresentable", () => {
  it("refuses a blank proposal — an Accept button on an empty page", () => {
    expect(proposalIsPresentable(read({}))).toBe(false);
    expect(proposalIsPresentable(read(null))).toBe(false);
  });

  it("a name alone is enough", () => {
    expect(proposalIsPresentable(read({ engagementName: "2026 tax" }))).toBe(true);
  });

  it("services alone are enough", () => {
    expect(
      proposalIsPresentable(read({ services: [{ name: "Bookkeeping" }] })),
    ).toBe(true);
  });

  it("terms alone are enough", () => {
    expect(proposalIsPresentable(read({ terms: "Our terms apply." }))).toBe(true);
  });

  it("whitespace-only content does NOT count as presentable", () => {
    expect(
      proposalIsPresentable(read({ engagementName: "   ", terms: "  " })),
    ).toBe(false);
  });
});
