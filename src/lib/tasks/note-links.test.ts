import { describe, it, expect } from "vitest";
import { noteLinks } from "./note-links";

describe("noteLinks", () => {
  it("finds a link in ordinary prose", () => {
    expect(noteLinks("Prep is in https://app.taxcycle.com/returns/2026")).toEqual([
      { href: "https://app.taxcycle.com/returns/2026", label: "app.taxcycle.com/returns/2026" },
    ]);
  });

  it("keeps the order they were written in", () => {
    // Somebody who put the return first and the working papers second meant
    // that; re-sorting would quietly rearrange their intent.
    const links = noteLinks("https://b.example.com then https://a.example.com");
    expect(links.map((l) => l.href)).toEqual([
      "https://b.example.com",
      "https://a.example.com",
    ]);
  });

  it("does not list the same link twice", () => {
    expect(noteLinks("https://x.com and again https://x.com")).toHaveLength(1);
  });

  // ⚠️ The guard that matters. A note is free text a person typed, and an href
  // is a way to make a click do something the writer did not intend. The rule
  // is an ALLOWLIST of schemes, not a blocklist of today's known tricks.
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("refuses %s", (bad) => {
    expect(noteLinks(`see ${bad} for details`)).toEqual([]);
  });

  it("allows plain http as well as https — internal tools are often not TLS", () => {
    expect(noteLinks("http://192.168.1.9/practice")).toHaveLength(1);
  });

  it("leaves the full stop out of the link at the end of a sentence", () => {
    const [link] = noteLinks("Filed here https://cra.gc.ca/x.");
    expect(link.href).toBe("https://cra.gc.ca/x");
  });

  it("does not swallow a closing bracket", () => {
    const [link] = noteLinks("(see https://cra.gc.ca/notice)");
    expect(link.href).toBe("https://cra.gc.ca/notice");
  });

  it("drops www and a trailing slash from the label, keeping the href intact", () => {
    const [link] = noteLinks("https://www.getcanopy.com/");
    expect(link.label).toBe("getcanopy.com");
    expect(link.href).toBe("https://www.getcanopy.com/");
  });

  it("shortens a long url so it cannot push the panel wide", () => {
    const long = `https://example.com/${"a".repeat(200)}`;
    const [link] = noteLinks(long);
    expect(link.label.length).toBeLessThanOrEqual(48);
    expect(link.label.endsWith("…")).toBe(true);
    // The href is never truncated — only what is shown.
    expect(link.href).toBe(long);
  });

  it.each([null, undefined, "", "no links in here at all"])(
    "returns nothing for %p",
    (note) => {
      expect(noteLinks(note as string | null | undefined)).toEqual([]);
    },
  );
});
