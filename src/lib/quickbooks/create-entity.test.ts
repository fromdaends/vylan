import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quickbooks/client", () => ({
  quickbooksCreateNameEntity: vi.fn(),
  quickbooksFindNameEntityByName: vi.fn(),
  // Real-ish: the create-or-find branch keys off this predicate.
  isDuplicateNameError: (e: unknown) =>
    /6240|Duplicate Name/i.test(String((e as Error)?.message ?? e)),
}));
vi.mock("@/lib/db/quickbooks-cache", () => ({
  upsertCachedEntityRow: vi.fn(),
}));

import {
  createOrFindNameEntity,
  normalizeEntityName,
  QBO_DISPLAY_NAME_MAX,
} from "./create-entity";
import {
  quickbooksCreateNameEntity,
  quickbooksFindNameEntityByName,
} from "@/lib/quickbooks/client";
import { upsertCachedEntityRow } from "@/lib/db/quickbooks-cache";

const mockCreate = vi.mocked(quickbooksCreateNameEntity);
const mockFind = vi.mocked(quickbooksFindNameEntityByName);
const mockUpsert = vi.mocked(upsertCachedEntityRow);

const ctx = { accessToken: "t", realmId: "r" } as never;
const NOW = "2026-07-13T15:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("normalizeEntityName", () => {
  it("trims and accepts a normal name", () => {
    expect(normalizeEntityName("  Northline Office  ")).toBe("Northline Office");
  });
  it("rejects empty, over-long, colon-bearing, and non-strings", () => {
    expect(normalizeEntityName("")).toBeNull();
    expect(normalizeEntityName("   ")).toBeNull();
    expect(normalizeEntityName("a".repeat(QBO_DISPLAY_NAME_MAX + 1))).toBeNull();
    expect(normalizeEntityName("Parent:Child")).toBeNull();
    expect(normalizeEntityName(42)).toBeNull();
    expect(normalizeEntityName(null)).toBeNull();
  });
});

describe("createOrFindNameEntity", () => {
  it("creates a vendor and caches it as an active row", async () => {
    mockCreate.mockResolvedValue({ id: "V9", name: "Northline Office" });

    const r = await createOrFindNameEntity({
      firmId: "f1",
      kind: "vendor",
      name: "Northline Office",
      ctx,
      now: NOW,
      clientId: "cli1",
    });

    expect(r).toEqual({ ok: true, entity: { id: "V9", name: "Northline Office" } });
    expect(mockFind).not.toHaveBeenCalled();
    // The new entity is cached against THAT client (0710 per-client), so the
    // draft for that client can find it as an active party.
    expect(mockUpsert).toHaveBeenCalledWith(
      "f1",
      "vendors",
      { id: "V9", name: "Northline Office", active: true },
      NOW,
      "cli1",
    );
  });

  it("caches a customer into the customers table", async () => {
    mockCreate.mockResolvedValue({ id: "C3", name: "Lumen Studio" });

    await createOrFindNameEntity({
      firmId: "f1",
      kind: "customer",
      name: "Lumen Studio",
      ctx,
      now: NOW,
    });

    // No clientId passed → firm-level cache row (undefined 5th arg).
    expect(mockUpsert).toHaveBeenCalledWith(
      "f1",
      "customers",
      { id: "C3", name: "Lumen Studio", active: true },
      NOW,
      undefined,
    );
  });

  it("falls back to a by-name lookup when QuickBooks says the name is a duplicate", async () => {
    mockCreate.mockRejectedValue(new Error("6240 Duplicate Name Exists Error"));
    mockFind.mockResolvedValue({ id: "V1", name: "Home Depot" });

    const r = await createOrFindNameEntity({
      firmId: "f1",
      kind: "vendor",
      name: "Home Depot",
      ctx,
      now: NOW,
    });

    expect(r).toEqual({ ok: true, entity: { id: "V1", name: "Home Depot" } });
    expect(mockFind).toHaveBeenCalledWith(ctx, "vendor", "Home Depot");
    // The found (existing) entity is still cached so the draft can post.
    expect(mockUpsert).toHaveBeenCalledWith(
      "f1",
      "vendors",
      { id: "V1", name: "Home Depot", active: true },
      NOW,
      undefined,
    );
  });

  it("returns a duplicate failure when the name exists but can't be found", async () => {
    mockCreate.mockRejectedValue(new Error("6240 Duplicate Name Exists Error"));
    mockFind.mockResolvedValue(null);

    const r = await createOrFindNameEntity({
      firmId: "f1",
      kind: "vendor",
      name: "Ghost Vendor",
      ctx,
      now: NOW,
    });

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: "duplicate" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns a plain failure (no lookup) on a non-duplicate error", async () => {
    mockCreate.mockRejectedValue(new Error("QuickBooks create failed (500)"));

    const r = await createOrFindNameEntity({
      firmId: "f1",
      kind: "vendor",
      name: "Whatever",
      ctx,
      now: NOW,
    });

    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
