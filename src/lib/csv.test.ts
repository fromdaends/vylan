import { describe, it, expect } from "vitest";
import { parseCsv, parseClientCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple comma-separated row", () => {
    expect(parseCsv("a,b,c")).toEqual([["a", "b", "c"]]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsv('"Hello, world",foo')).toEqual([["Hello, world", "foo"]]);
  });

  it("handles escaped quotes inside quotes", () => {
    expect(parseCsv('"He said ""hi""",bar')).toEqual([
      ['He said "hi"', "bar"],
    ]);
  });

  it("handles \\r\\n line endings", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });

  it("skips fully empty trailing line", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });
});

describe("parseClientCsv", () => {
  it("parses canonical headers", () => {
    const csv = [
      "name,email,phone,type,language",
      "Acme Inc.,billing@acme.example,5145551111,business,en",
      "Jean Bouchard,jb@example.com,,individual,fr",
    ].join("\n");
    const out = parseClientCsv(csv);
    expect(out.invalid).toEqual([]);
    expect(out.valid).toHaveLength(2);
    expect(out.valid[0]).toMatchObject({
      display_name: "Acme Inc.",
      email: "billing@acme.example",
      phone: "5145551111",
      type: "business",
      locale: "en",
    });
    expect(out.valid[1]).toMatchObject({
      display_name: "Jean Bouchard",
      phone: null,
      type: "individual",
      locale: "fr",
    });
  });

  it("accepts French headers", () => {
    const csv = ["nom,courriel,téléphone", "Test,t@x.com,5145551234"].join(
      "\n",
    );
    const out = parseClientCsv(csv);
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0].display_name).toBe("Test");
    expect(out.valid[0].email).toBe("t@x.com");
    expect(out.valid[0].phone).toBe("5145551234");
  });

  it("flags rows missing the name column", () => {
    const csv = ["name,email", ",missing@x.com", "Valid,ok@x.com"].join("\n");
    const out = parseClientCsv(csv);
    expect(out.valid).toHaveLength(1);
    expect(out.invalid).toHaveLength(1);
    expect(out.invalid[0].error).toBe("missing_name");
  });

  it("defaults type to individual and locale to fr when missing", () => {
    const csv = ["name", "Jeanne"].join("\n");
    const out = parseClientCsv(csv);
    expect(out.valid[0]).toMatchObject({
      type: "individual",
      locale: "fr",
    });
  });

  it("warns about unknown columns", () => {
    const csv = "name,zodiac\nJean,Aquarius";
    const out = parseClientCsv(csv);
    expect(out.headerWarnings).toContain("unknown_column:zodiac");
  });
});
