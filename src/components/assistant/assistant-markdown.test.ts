import { describe, expect, it } from "vitest";
import {
  parseAssistantMarkdown,
  parseInlineSpans,
} from "./assistant-markdown";

describe("parseInlineSpans", () => {
  it("splits bold out of surrounding text", () => {
    expect(parseInlineSpans("The **T4** is missing")).toEqual([
      { type: "text", value: "The " },
      { type: "bold", value: "T4" },
      { type: "text", value: " is missing" },
    ]);
  });

  it("handles italic and inline code", () => {
    expect(parseInlineSpans("*note* and `code`")).toEqual([
      { type: "italic", value: "note" },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
    ]);
  });

  it("prefers bold over italic for double asterisks", () => {
    expect(parseInlineSpans("**bold**")).toEqual([
      { type: "bold", value: "bold" },
    ]);
  });

  it("leaves snake_case identifiers intact", () => {
    expect(parseInlineSpans("field_one and field_two")).toEqual([
      { type: "text", value: "field_one and field_two" },
    ]);
  });

  it("renders an unclosed marker literally (mid-stream)", () => {
    expect(parseInlineSpans("almost **bol")).toEqual([
      { type: "text", value: "almost **bol" },
    ]);
  });

  it("never returns an empty span list", () => {
    expect(parseInlineSpans("")).toEqual([{ type: "text", value: "" }]);
  });
});

describe("parseAssistantMarkdown", () => {
  it("parses a bullet list into one block", () => {
    const blocks = parseAssistantMarkdown("- first\n- second\n- third");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("bullets");
    if (blocks[0].type === "bullets") {
      expect(blocks[0].items).toHaveLength(3);
      expect(blocks[0].items[0]).toEqual([{ type: "text", value: "first" }]);
    }
  });

  it("parses a numbered list into one block", () => {
    const blocks = parseAssistantMarkdown("1. do this\n2. then that");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("numbered");
    if (blocks[0].type === "numbered") {
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it("separates a paragraph from a following list", () => {
    const blocks = parseAssistantMarkdown(
      "Here is what is missing:\n\n- T4\n- RL-1",
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "bullets"]);
  });

  it("keeps consecutive plain lines in one paragraph", () => {
    const blocks = parseAssistantMarkdown("line one\nline two");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    if (blocks[0].type === "paragraph") {
      expect(blocks[0].lines).toHaveLength(2);
    }
  });

  it("bold survives inside a bullet item", () => {
    const blocks = parseAssistantMarkdown("- The **balance** is 1200");
    expect(blocks[0].type).toBe("bullets");
    if (blocks[0].type === "bullets") {
      expect(blocks[0].items[0]).toContainEqual({
        type: "bold",
        value: "balance",
      });
    }
  });

  it("strips headings, rules, and blockquotes the panel won't render", () => {
    const blocks = parseAssistantMarkdown(
      "## Heading\n\n---\n\n> quoted\n\nplain",
    );
    // No block should carry the raw markers.
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain("#");
    expect(flat).not.toContain("---");
    expect(flat).toContain("Heading");
    expect(flat).toContain("quoted");
    expect(flat).toContain("plain");
  });

  it("returns no blocks for empty input", () => {
    expect(parseAssistantMarkdown("")).toEqual([]);
    expect(parseAssistantMarkdown("   \n\n  ")).toEqual([]);
  });
});
