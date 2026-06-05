import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";

// Guards the hand-written built-in template seed (migration 0170). A template
// item's doc_type becomes a real request_items.doc_type (a Postgres enum) when
// an engagement is created from it, so an invalid code here would break
// engagement creation in production — exactly what this test catches early.

const MIGRATION = "supabase/migrations/0170_more_builtin_templates.sql";
const VALID_DOC_TYPES = new Set(Object.keys(DOC_TYPE_LABELS));
// EngagementType union — keeping new templates within these means no gallery /
// type-union / UI changes are needed (see the migration header).
const VALID_TYPES = new Set(["t1", "t2", "bookkeeping", "custom"]);
const BLANK_ID = "00000000-0000-0000-0000-000000000004";

const sql = readFileSync(MIGRATION, "utf8");

// Each template's items live in a dollar-quoted $$[ ... ]$$ block.
const itemBlocks = [...sql.matchAll(/\$\$(\[[\s\S]*?\])\$\$/g)].map((m) =>
  JSON.parse(m[1]),
) as Array<
  Array<{
    label_fr: string;
    label_en: string;
    description_fr?: string;
    description_en?: string;
    doc_type: string;
    required: boolean;
  }>
>;
// The `type` is the quoted token immediately preceding each items block.
const types = [...sql.matchAll(/'([^']*)',\s*\$\$\[/g)].map((m) => m[1]);
// All seeded template ids.
const ids = [
  ...sql.matchAll(/'(00000000-0000-0000-0000-[0-9a-f]{12})'/g),
].map((m) => m[1]);

describe("built-in template seed (0170)", () => {
  it("seeds the expected number of templates", () => {
    expect(itemBlocks).toHaveLength(6);
    expect(types).toHaveLength(6);
  });

  it("uses only valid doc_type enum values on every item", () => {
    const bad: string[] = [];
    for (const items of itemBlocks) {
      for (const item of items) {
        if (!VALID_DOC_TYPES.has(item.doc_type)) bad.push(item.doc_type);
      }
    }
    expect(bad).toEqual([]);
  });

  it("uses only existing engagement types (no UI/union changes needed)", () => {
    for (const t of types) expect(VALID_TYPES.has(t)).toBe(true);
  });

  it("gives every item both language labels, a doc_type, and a boolean required", () => {
    for (const items of itemBlocks) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.label_fr?.trim().length ?? 0).toBeGreaterThan(0);
        expect(item.label_en?.trim().length ?? 0).toBeGreaterThan(0);
        expect(typeof item.doc_type).toBe("string");
        expect(typeof item.required).toBe("boolean");
      }
    }
  });

  it("uses unique ids that don't collide with the original built-ins or the blank", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(BLANK_ID);
    // The six new ids must be outside 0001..0004.
    const reserved = new Set([
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "00000000-0000-0000-0000-000000000003",
      "00000000-0000-0000-0000-000000000004",
    ]);
    for (const id of ids) expect(reserved.has(id)).toBe(false);
  });
});
