import { describe, it, expect } from "vitest";
import { parseDraftTeam } from "./draft-team";

// The create dialog posts this as a hidden field, so it is browser-supplied and
// gets narrowed like any other untrusted input. Every rejection path here ends
// with the client still being created — losing a team is recoverable in one
// panel; losing the client is not.
describe("parseDraftTeam", () => {
  it("reads the rows the editor posts", () => {
    expect(
      parseDraftTeam(
        JSON.stringify([
          { userId: "u1", position: "Manager" },
          { userId: "u2", position: null },
        ]),
      ),
    ).toEqual([
      { userId: "u1", position: "Manager" },
      { userId: "u2", position: null },
    ]);
  });

  it("treats nothing chosen as no team", () => {
    expect(parseDraftTeam(null)).toEqual([]);
    expect(parseDraftTeam("")).toEqual([]);
    expect(parseDraftTeam("[]")).toEqual([]);
  });

  it("survives a malformed payload instead of failing the create", () => {
    expect(parseDraftTeam("not json")).toEqual([]);
    expect(parseDraftTeam('{"userId":"u1"}')).toEqual([]);
    expect(parseDraftTeam("[1, null, true]")).toEqual([]);
  });

  it("drops rows with no usable id", () => {
    expect(
      parseDraftTeam(JSON.stringify([{ userId: "  " }, { position: "Manager" }])),
    ).toEqual([]);
  });

  it("keeps one row per person", () => {
    // Two rows for the same person would upsert twice — harmless, but the
    // second would silently overwrite the first's position.
    expect(
      parseDraftTeam(
        JSON.stringify([
          { userId: "u1", position: "Manager" },
          { userId: "u1", position: "Preparer" },
        ]),
      ),
    ).toEqual([{ userId: "u1", position: "Manager" }]);
  });

  it("trims a position and treats blank as none", () => {
    expect(parseDraftTeam(JSON.stringify([{ userId: "u1", position: "  Manager  " }])))
      .toEqual([{ userId: "u1", position: "Manager" }]);
    expect(parseDraftTeam(JSON.stringify([{ userId: "u1", position: "   " }])))
      .toEqual([{ userId: "u1", position: null }]);
  });

  it("caps a position so a long string cannot be posted into the roster", () => {
    const long = "x".repeat(200);
    expect(parseDraftTeam(JSON.stringify([{ userId: "u1", position: long }]))[0]!.position)
      .toHaveLength(60);
  });
});
