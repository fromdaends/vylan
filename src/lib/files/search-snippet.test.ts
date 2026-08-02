import { describe, it, expect } from "vitest";
import { splitSnippet } from "./search-snippet";

// The snippet text comes out of client-uploaded documents. It must NEVER be
// rendered as HTML — these tests pin the split-and-mark contract the UI
// renders as plain React elements instead.
describe("splitSnippet", () => {
  it("marks matched words and keeps everything else plain", () => {
    expect(splitSnippet("paid to <b>Hydro</b> Quebec for <b>March</b>")).toEqual([
      { text: "paid to ", marked: false },
      { text: "Hydro", marked: true },
      { text: " Quebec for ", marked: false },
      { text: "March", marked: true },
    ]);
  });

  it("a snippet with no matches is one plain part", () => {
    expect(splitSnippet("nothing highlighted here")).toEqual([
      { text: "nothing highlighted here", marked: false },
    ]);
  });

  it("HTML inside the DOCUMENT text stays text — only ts_headline's own <b> markers split", () => {
    const parts = splitSnippet("total <b>due</b>: <script>alert(1)</script>");
    expect(parts).toEqual([
      { text: "total ", marked: false },
      { text: "due", marked: true },
      { text: ": <script>alert(1)</script>", marked: false },
    ]);
  });

  it("leading match and empty string behave", () => {
    expect(splitSnippet("<b>T4</b> slip")).toEqual([
      { text: "T4", marked: true },
      { text: " slip", marked: false },
    ]);
    expect(splitSnippet("")).toEqual([]);
  });
});
