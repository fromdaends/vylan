import { describe, it, expect } from "vitest";
import { buildRequestItemRow, pickItemText } from "./request-item-row";

describe("pickItemText", () => {
  // THE REGRESSION, read side. Engagements created before buildRequestItemRow
  // existed have description_fr only, and there is no migration repairing them.
  // An English client must still see the instructions rather than a blank.
  it("falls back to French when the English column is empty", () => {
    expect(pickItemText("en", "Envoyez le feuillet", null)).toBe(
      "Envoyez le feuillet",
    );
  });

  it("falls back to English when the French column is empty", () => {
    expect(pickItemText("fr", null, "Send the slip")).toBe("Send the slip");
  });

  it("prefers the reader's own language when both exist", () => {
    expect(pickItemText("en", "Feuillet T4", "T4 slip")).toBe("T4 slip");
    expect(pickItemText("fr", "Feuillet T4", "T4 slip")).toBe("Feuillet T4");
  });

  it("treats whitespace-only as empty in either column", () => {
    expect(pickItemText("en", "Feuillet T4", "   ")).toBe("Feuillet T4");
    expect(pickItemText("fr", "  ", "T4 slip")).toBe("T4 slip");
  });

  it("returns null when a description is genuinely absent", () => {
    // The portal renders the description block only when there is text, so
    // absent must stay falsy rather than becoming an empty-looking string.
    expect(pickItemText("en", null, null)).toBeNull();
    expect(pickItemText("fr", undefined, undefined)).toBeNull();
  });
});

const BASE = { doc_type: "t4" as string | null, required: true };

describe("buildRequestItemRow", () => {
  // THE REGRESSION. The engagement builder has one description box that fed
  // description_fr only, so items created with an engagement stored a null
  // English description and English portal clients saw no instructions.
  it("mirrors a French-only description into the English column", () => {
    const row = buildRequestItemRow(
      "eng-1",
      {
        ...BASE,
        label_fr: "Relevé 1",
        description_fr: "Envoyez le feuillet complet",
      },
      0,
    );
    expect(row.description).toBe("Envoyez le feuillet complet");
    expect(row.description_fr).toBe("Envoyez le feuillet complet");
  });

  it("mirrors an English-only description into the French column", () => {
    const row = buildRequestItemRow(
      "eng-1",
      { ...BASE, label: "T4", description: "Send the full slip" },
      0,
    );
    expect(row.description).toBe("Send the full slip");
    expect(row.description_fr).toBe("Send the full slip");
  });

  it("mirrors labels the same way in both directions", () => {
    expect(
      buildRequestItemRow("e", { ...BASE, label_fr: "Relevé 1" }, 0),
    ).toMatchObject({ label: "Relevé 1", label_fr: "Relevé 1" });
    expect(
      buildRequestItemRow("e", { ...BASE, label: "T4" }, 0),
    ).toMatchObject({ label: "T4", label_fr: "T4" });
  });

  it("keeps two genuine translations distinct", () => {
    // Mirroring is a fallback, never an overwrite.
    const row = buildRequestItemRow(
      "eng-1",
      {
        ...BASE,
        label: "T4",
        label_fr: "Relevé 1",
        description: "Send the full slip",
        description_fr: "Envoyez le feuillet complet",
      },
      0,
    );
    expect(row.label).toBe("T4");
    expect(row.label_fr).toBe("Relevé 1");
    expect(row.description).toBe("Send the full slip");
    expect(row.description_fr).toBe("Envoyez le feuillet complet");
  });

  it("leaves both columns null when there is no description at all", () => {
    // A description is optional. Absent must stay absent in BOTH columns, not
    // become an empty string, so the portal's "is there text" check still works.
    const row = buildRequestItemRow("e", { ...BASE, label: "T4" }, 0);
    expect(row.description).toBeNull();
    expect(row.description_fr).toBeNull();
  });

  it("treats whitespace-only input as absent", () => {
    // A textarea the user tabbed through must not beat the side with real text.
    const row = buildRequestItemRow(
      "e",
      { ...BASE, description: "   ", description_fr: "Envoyez le feuillet" },
      0,
    );
    expect(row.description).toBe("Envoyez le feuillet");
    expect(row.description_fr).toBe("Envoyez le feuillet");
  });

  it("trims stored text", () => {
    const row = buildRequestItemRow(
      "e",
      { ...BASE, label: "  T4  ", description: "  Send it  " },
      0,
    );
    expect(row.label).toBe("T4");
    expect(row.description).toBe("Send it");
  });

  it("carries engagement id, order index, doc type and required through", () => {
    const row = buildRequestItemRow(
      "eng-9",
      { label: "T4", doc_type: null, required: false },
      4,
    );
    expect(row).toMatchObject({
      engagement_id: "eng-9",
      order_index: 4,
      doc_type: null,
      required: false,
    });
  });
});
