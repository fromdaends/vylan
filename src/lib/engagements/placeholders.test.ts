// Dynamic placeholders in an engagement's name.
//
// The rule almost everything here defends: an UNKNOWN value leaves its token
// alone. Blanking it would turn "Bookkeeping for {{clientname}}" into
// "Bookkeeping for " the moment somebody typed a name before picking a client
// — and that string would then be SAVED.

import { describe, expect, it } from "vitest";
import {
  hasUnresolved,
  placeholderText,
  resolvePlaceholders,
} from "./placeholders";

const NOW = new Date("2026-08-05T12:00:00Z");

describe("resolvePlaceholders", () => {
  it("fills in what it knows", () => {
    expect(
      resolvePlaceholders(
        "Monthly bookkeeping for {{clientname}}",
        { clientName: "Abercrombie International Group" },
        NOW,
      ),
    ).toBe("Monthly bookkeeping for Abercrombie International Group");
  });

  it("LEAVES a token whose value is not known yet", () => {
    // The whole point. A half-filled form must never produce a half-finished
    // string that then gets saved.
    for (const v of [undefined, null, "", "   "]) {
      expect(
        resolvePlaceholders("Work for {{clientname}}", { clientName: v }, NOW),
      ).toBe("Work for {{clientname}}");
    }
  });

  it("leaves a token it does not recognise", () => {
    expect(resolvePlaceholders("A {{nonsense}} B", {}, NOW)).toBe(
      "A {{nonsense}} B",
    );
  });

  it("resolves several tokens in one string", () => {
    expect(
      resolvePlaceholders(
        "{{firmname}} — {{clientname}} — {{taxyear}}",
        { firmName: "Cabinet Tremblay", clientName: "Emma Wright", taxYear: 2025 },
        NOW,
      ),
    ).toBe("Cabinet Tremblay — Emma Wright — 2025");
  });

  it("takes the date from the clock it is GIVEN", () => {
    // Injected rather than read from Date.now() so this is testable, and so a
    // server and a client resolving the same string cannot disagree across a
    // midnight boundary.
    expect(resolvePlaceholders("{{currentyear}}", {}, NOW)).toBe("2026");
    expect(
      resolvePlaceholders("{{currentyear}}", {}, new Date("2031-01-02T00:00:00Z")),
    ).toBe("2031");
  });

  it("localises the month name", () => {
    expect(resolvePlaceholders("{{currentmonth}}", {}, NOW, "en")).toBe("August");
    expect(resolvePlaceholders("{{currentmonth}}", {}, NOW, "fr")).toBe("août");
  });

  it("tolerates case and inner spaces", () => {
    // Somebody typing {{ ClientName }} by hand means the same thing, and
    // failing on it would be a puzzle rather than a rule.
    expect(
      resolvePlaceholders("{{ ClientName }}", { clientName: "Ecker" }, NOW),
    ).toBe("Ecker");
    expect(
      resolvePlaceholders("{{CLIENTNAME}}", { clientName: "Ecker" }, NOW),
    ).toBe("Ecker");
  });

  it("leaves text with no tokens exactly as it is", () => {
    expect(resolvePlaceholders("T1 — 2026", { clientName: "X" }, NOW)).toBe(
      "T1 — 2026",
    );
  });

  it("does not treat a lone brace as a token", () => {
    expect(resolvePlaceholders("{not a token}", {}, NOW)).toBe("{not a token}");
  });

  it("keeps a zero-ish tax year rather than dropping it", () => {
    expect(resolvePlaceholders("{{taxyear}}", { taxYear: 0 }, NOW)).toBe("0");
  });
});

describe("hasUnresolved", () => {
  it("spots a token that survived resolution", () => {
    expect(hasUnresolved("Work for {{clientname}}")).toBe(true);
    expect(hasUnresolved("Work for Emma")).toBe(false);
  });
});

describe("placeholderText", () => {
  it("writes the token the resolver reads", () => {
    // Guards the two halves drifting: the picker inserts this, the resolver
    // parses it.
    const text = placeholderText("clientname");
    expect(text).toBe("{{clientname}}");
    expect(resolvePlaceholders(text, { clientName: "Kari" }, NOW)).toBe("Kari");
  });
});
