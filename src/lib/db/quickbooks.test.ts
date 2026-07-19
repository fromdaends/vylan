import { describe, it, expect, vi } from "vitest";
import { isFirmLevelScope, runWithClientFallback } from "./quickbooks";

// Regression guard for the per-client graceful-degradation bug: pre-0710 the
// client_id column doesn't exist, so the scoped query errors. Dropping the
// client_id filter (the legacy fallback) is ONLY safe for a firm-level scope —
// for a SPECIFIC client it would wrongly hit the firm-level row (wrong reads /
// disconnect DATA LOSS / connect clobber). These lock in that gating.

describe("isFirmLevelScope", () => {
  it("treats undefined and null as firm-level; a uuid as a specific client", () => {
    expect(isFirmLevelScope(undefined)).toBe(true);
    expect(isFirmLevelScope(null)).toBe(true);
    expect(isFirmLevelScope("11111111-1111-1111-1111-111111111111")).toBe(false);
  });
});

describe("runWithClientFallback — pre-0710 degradation gating", () => {
  type Res = { error: { code?: string; message?: string } | null; data?: string };
  const schemaErr = { code: "42703", message: 'column "client_id" does not exist' };
  const ok = (v: string): Promise<Res> => Promise.resolve({ error: null, data: v });
  const failSchema = (): Promise<Res> => Promise.resolve({ error: schemaErr });

  it("firm-level (null): a missing-schema error degrades to the legacy query", async () => {
    const legacy = vi.fn(() => ok("legacy"));
    const res = await runWithClientFallback(null, failSchema, legacy);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ error: null, data: "legacy" });
  });

  it("firm-level (undefined): also degrades to the legacy query", async () => {
    const legacy = vi.fn(() => ok("legacy"));
    await runWithClientFallback(undefined, failSchema, legacy);
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it("specific client: NEVER falls back on missing-schema — no firm-level touch", async () => {
    const legacy = vi.fn(() => ok("legacy"));
    const res = await runWithClientFallback(
      "22222222-2222-2222-2222-222222222222",
      failSchema,
      legacy,
    );
    expect(legacy).not.toHaveBeenCalled();
    expect(res.error).toEqual(schemaErr);
  });

  it("does not fall back when the scoped query succeeds", async () => {
    const legacy = vi.fn(() => ok("legacy"));
    const res = await runWithClientFallback(null, () => ok("scoped"), legacy);
    expect(legacy).not.toHaveBeenCalled();
    expect(res).toEqual({ error: null, data: "scoped" });
  });

  it("does not fall back on a non-schema error, even firm-level", async () => {
    const legacy = vi.fn(() => ok("legacy"));
    const otherErr = { code: "23505", message: "duplicate key value" };
    const res = await runWithClientFallback(
      null,
      (): Promise<Res> => Promise.resolve({ error: otherErr }),
      legacy,
    );
    expect(legacy).not.toHaveBeenCalled();
    expect(res.error).toEqual(otherErr);
  });
});
