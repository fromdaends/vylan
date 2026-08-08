import { describe, it, expect } from "vitest";
import { splitBodyMentions } from "./mentions";

const MEMBERS = [
  { id: "u-sam", name: "Sam" },
  { id: "u-samantha", name: "Samantha" },
  { id: "u-marie", name: "Marie Fortin" },
];
const ALL = MEMBERS.map((m) => m.id);

describe("splitBodyMentions", () => {
  it("paints a mention and leaves the rest as text", () => {
    expect(splitBodyMentions("hey @Sam can you look?", MEMBERS, ALL)).toEqual([
      { kind: "text", text: "hey " },
      { kind: "mention", text: "@Sam", userId: "u-sam" },
      { kind: "text", text: " can you look?" },
    ]);
  });

  it("handles a name with a space in it", () => {
    expect(splitBodyMentions("@Marie Fortin ping", MEMBERS, ALL)).toEqual([
      { kind: "mention", text: "@Marie Fortin", userId: "u-marie" },
      { kind: "text", text: " ping" },
    ]);
  });

  it("LONGEST NAME WINS — @Samantha is not eaten by Sam", () => {
    expect(splitBodyMentions("@Samantha hi", MEMBERS, ALL)).toEqual([
      { kind: "mention", text: "@Samantha", userId: "u-samantha" },
      { kind: "text", text: " hi" },
    ]);
  });

  it("does not paint @Marie inside @Marie-Claude (the hyphen case)", () => {
    // The exact mis-attribution the composer's own lookahead prevents: Marie
    // is legitimately in `mentions` from her own mention earlier in the body.
    const roster = [{ id: "u-marie", name: "Marie" }];
    const out = splitBodyMentions(
      "@Marie can you loop in @Marie-Claude?",
      roster,
      ["u-marie"],
    );
    expect(out.filter((s) => s.kind === "mention")).toHaveLength(1);
    expect(out.map((s) => s.text).join("")).toBe(
      "@Marie can you loop in @Marie-Claude?",
    );
  });

  it("does not paint a name followed by a dot-suffixed longer name", () => {
    const roster = [{ id: "u-jo", name: "Jo" }];
    expect(
      splitBodyMentions("@Jo.Smith filed it", roster, ["u-jo"]),
    ).toEqual([{ kind: "text", text: "@Jo.Smith filed it" }]);
  });

  it("respects the word boundary — @Sammy is nobody", () => {
    expect(splitBodyMentions("@Sammy hi", MEMBERS, ALL)).toEqual([
      { kind: "text", text: "@Sammy hi" },
    ]);
  });

  it("paints several mentions in one body", () => {
    const out = splitBodyMentions("@Sam and @Marie Fortin", MEMBERS, ALL);
    expect(out.filter((s) => s.kind === "mention")).toHaveLength(2);
  });

  it("only paints ids the row actually recorded", () => {
    // Typed by hand, never picked from the menu → no notification, no colour.
    expect(splitBodyMentions("@Sam hello", MEMBERS, [])).toEqual([
      { kind: "text", text: "@Sam hello" },
    ]);
  });

  it("leaves an ordinary email-ish @ alone", () => {
    expect(splitBodyMentions("mail me at a@b.com", MEMBERS, ALL)).toEqual([
      { kind: "text", text: "mail me at a@b.com" },
    ]);
  });

  it("survives an empty body and an empty roster", () => {
    expect(splitBodyMentions("", MEMBERS, ALL)).toEqual([]);
    expect(splitBodyMentions("hi", [], [])).toEqual([
      { kind: "text", text: "hi" },
    ]);
  });

  it("keeps punctuation attached to the text, not the name", () => {
    expect(splitBodyMentions("thanks @Sam!", MEMBERS, ALL)).toEqual([
      { kind: "text", text: "thanks " },
      { kind: "mention", text: "@Sam", userId: "u-sam" },
      { kind: "text", text: "!" },
    ]);
  });
});
