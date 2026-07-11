import { describe, expect, it } from "vitest";
import { mergeThreadItems, type ActionCardData } from "./thread";

function card(id: string, createdAt: string): ActionCardData {
  return {
    id,
    type: "approve_document",
    payload: {},
    status: "proposed",
    createdAt,
    expiresAt: "2026-07-11T20:00:00Z",
    error: null,
    token: "tok",
  };
}

const msg = (
  role: "user" | "assistant",
  content: string,
  createdAt: string,
) => ({ role, content, createdAt });

describe("mergeThreadItems", () => {
  it("interleaves cards between the turns that produced them", () => {
    const items = mergeThreadItems(
      [
        msg("user", "approve the T4", "2026-07-11T10:00:00Z"),
        msg("assistant", "Proposed — confirm below.", "2026-07-11T10:00:05Z"),
      ],
      [card("a1", "2026-07-11T10:00:03Z")],
    );
    expect(items.map((i) => i.kind)).toEqual(["message", "action", "message"]);
  });

  it("messages win ties so a card never jumps ahead of its user turn", () => {
    const at = "2026-07-11T10:00:00Z";
    const items = mergeThreadItems([msg("user", "go", at)], [card("a1", at)]);
    expect(items.map((i) => i.kind)).toEqual(["message", "action"]);
  });

  it("handles empty inputs", () => {
    expect(mergeThreadItems([], [])).toEqual([]);
    expect(mergeThreadItems([], [card("a1", "2026-07-11T10:00:00Z")])).toHaveLength(1);
    expect(
      mergeThreadItems([msg("user", "hi", "2026-07-11T10:00:00Z")], []),
    ).toHaveLength(1);
  });

  it("keeps multiple cards in creation order", () => {
    const items = mergeThreadItems(
      [msg("user", "clean up the checklist", "2026-07-11T10:00:00Z")],
      [
        card("a2", "2026-07-11T10:00:04Z"),
        card("a1", "2026-07-11T10:00:02Z"),
      ].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    );
    expect(items.map((i) => (i.kind === "action" ? i.action.id : "m"))).toEqual([
      "m",
      "a1",
      "a2",
    ]);
  });
});
