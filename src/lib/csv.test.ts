import { describe, it, expect } from "vitest";
import { csvDocument, csvLine, parseCsv, parseClientCsv } from "./csv";

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

describe("csvLine (writer)", () => {
  it("joins cells with commas and terminates with CRLF", () => {
    expect(csvLine(["a", "b", "c"])).toBe("a,b,c\r\n");
  });

  it("quotes fields containing commas", () => {
    expect(csvLine(["a", "x,y", "c"])).toBe('a,"x,y",c\r\n');
  });

  it("doubles internal double-quotes and wraps the cell in quotes", () => {
    expect(csvLine(['she said "hi"'])).toBe('"she said ""hi"""\r\n');
  });

  it("quotes fields containing newlines", () => {
    expect(csvLine(["a\nb"])).toBe('"a\nb"\r\n');
  });

  it("renders null and undefined as empty fields", () => {
    expect(csvLine([null, "x", undefined])).toBe(",x,\r\n");
  });

  it("renders Date as ISO 8601", () => {
    const d = new Date("2026-05-15T12:34:56.000Z");
    expect(csvLine([d])).toBe("2026-05-15T12:34:56.000Z\r\n");
  });

  it("renders booleans as 'true'/'false'", () => {
    expect(csvLine([true, false])).toBe("true,false\r\n");
  });

  it("renders finite numbers as decimals; NaN/Infinity become empty", () => {
    expect(csvLine([1, 1.5, -2])).toBe("1,1.5,-2\r\n");
    expect(csvLine([NaN, Infinity])).toBe(",\r\n");
  });
});

describe("csvDocument", () => {
  it("emits a header row followed by data rows", () => {
    const out = csvDocument(
      ["id", "name"],
      [
        [1, "Alice"],
        [2, "Bob, Jr."],
      ],
    );
    expect(out).toBe(`id,name\r\n1,Alice\r\n2,"Bob, Jr."\r\n`);
  });
});
