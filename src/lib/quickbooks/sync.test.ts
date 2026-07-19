import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/quickbooks/read", () => ({ readQuickbooksLists: vi.fn() }));
vi.mock("@/lib/db/quickbooks-cache", () => ({
  setFirmSyncState: vi.fn(),
  replaceCachedEntity: vi.fn(),
}));
vi.mock("@/lib/db/jobs", () => ({
  enqueueJob: vi.fn(),
  cancelPendingJobs: vi.fn(),
}));

import {
  syncQuickbooksLists,
  processSyncQuickbooksJob,
  enqueueQuickbooksSync,
} from "./sync";
import { readQuickbooksLists } from "@/lib/quickbooks/read";
import { setFirmSyncState, replaceCachedEntity } from "@/lib/db/quickbooks-cache";
import { enqueueJob, cancelPendingJobs } from "@/lib/db/jobs";

const mockRead = vi.mocked(readQuickbooksLists);
const mockSetState = vi.mocked(setFirmSyncState);
const mockReplace = vi.mocked(replaceCachedEntity);
const mockEnqueue = vi.mocked(enqueueJob);
const mockCancel = vi.mocked(cancelPendingJobs);

const FULL = {
  ok: true as const,
  data: {
    accounts: [{ id: "1", name: "Checking", accountType: "Bank", active: true }],
    vendors: [{ id: "2", name: "Acme", active: true }],
    customers: [{ id: "3", name: "Bob", active: true }],
    taxCodes: [{ id: "4", name: "GST", active: true }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockSetState.mockResolvedValue(undefined);
  mockReplace.mockResolvedValue(undefined);
  mockEnqueue.mockResolvedValue(undefined);
  mockCancel.mockResolvedValue(0);
});

describe("syncQuickbooksLists", () => {
  it("marks syncing then error and bails when not connected", async () => {
    mockRead.mockResolvedValue({ ok: false, reason: "not_connected" });
    const r = await syncQuickbooksLists("f1");
    expect(r).toEqual({ ok: false, detail: "not_connected" });
    expect(mockSetState).toHaveBeenCalledWith(
      "f1",
      { status: "syncing" },
      undefined,
    );
    expect(mockSetState).toHaveBeenLastCalledWith(
      "f1",
      { status: "error", error: "not_connected" },
      undefined,
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("replaces all four entities and marks ok on success", async () => {
    mockRead.mockResolvedValue(FULL);
    const r = await syncQuickbooksLists("f1");
    expect(r.ok).toBe(true);
    expect(mockReplace).toHaveBeenCalledTimes(4);
    expect(mockReplace).toHaveBeenCalledWith(
      "f1",
      "accounts",
      FULL.data.accounts,
      expect.any(String),
      undefined,
    );
    const last = mockSetState.mock.calls.at(-1)?.[1];
    expect(last?.status).toBe("ok");
    expect(last?.lastSyncedAt).toEqual(expect.any(String));
  });

  it("scopes the sync to a client when given a clientId", async () => {
    mockRead.mockResolvedValue(FULL);
    await syncQuickbooksLists("f1", "c1");
    expect(mockRead).toHaveBeenCalledWith("f1", "c1");
    expect(mockReplace).toHaveBeenCalledWith(
      "f1",
      "accounts",
      FULL.data.accounts,
      expect.any(String),
      "c1",
    );
    expect(mockSetState).toHaveBeenCalledWith(
      "f1",
      { status: "syncing" },
      "c1",
    );
  });

  it("leaves a failed (null) list untouched and records a partial error", async () => {
    mockRead.mockResolvedValue({
      ok: true,
      data: { ...FULL.data, vendors: null },
    });
    const r = await syncQuickbooksLists("f1");
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("partial");
    expect(mockReplace).toHaveBeenCalledTimes(3);
    const entities = mockReplace.mock.calls.map((c) => c[1]);
    expect(entities).not.toContain("vendors");
    const last = mockSetState.mock.calls.at(-1)?.[1];
    expect(last?.status).toBe("error");
    // Partial syncs must NOT stamp lastSyncedAt (keep the last clean time).
    expect(last?.lastSyncedAt).toBeUndefined();
  });

  it("records an error when a cache write throws", async () => {
    mockRead.mockResolvedValue(FULL);
    mockReplace.mockRejectedValueOnce(new Error("db down"));
    const r = await syncQuickbooksLists("f1");
    expect(r).toEqual({ ok: false, detail: "cache_write_failed" });
    expect(mockSetState.mock.calls.at(-1)?.[1].status).toBe("error");
  });
});

describe("processSyncQuickbooksJob", () => {
  it("returns no_firm_id when the payload has no firmId (and never reads)", async () => {
    expect(await processSyncQuickbooksJob({})).toEqual({
      ok: false,
      detail: "no_firm_id",
    });
    expect(mockRead).not.toHaveBeenCalled();
  });
  it("syncs when given a firmId", async () => {
    mockRead.mockResolvedValue(FULL);
    expect((await processSyncQuickbooksJob({ firmId: "f1" })).ok).toBe(true);
  });
});

describe("enqueueQuickbooksSync", () => {
  it("dedups pending jobs (by firmId) then enqueues + marks syncing", async () => {
    await enqueueQuickbooksSync("f1");
    expect(mockCancel).toHaveBeenCalledWith(
      "sync_quickbooks",
      expect.any(Function),
    );
    const matcher = mockCancel.mock.calls[0][1];
    expect(matcher({ firmId: "f1" })).toBe(true);
    expect(matcher({ firmId: "f2" })).toBe(false);
    expect(mockEnqueue).toHaveBeenCalledWith({
      kind: "sync_quickbooks",
      payload: { firmId: "f1", clientId: null },
      runAfter: expect.any(Date),
    });
    expect(mockSetState).toHaveBeenCalledWith(
      "f1",
      { status: "syncing" },
      undefined,
    );
  });
  it("scopes the enqueued job + dedup to the client when given a clientId", async () => {
    await enqueueQuickbooksSync("f1", "c1");
    expect(mockEnqueue).toHaveBeenCalledWith({
      kind: "sync_quickbooks",
      payload: { firmId: "f1", clientId: "c1" },
      runAfter: expect.any(Date),
    });
    const matcher = mockCancel.mock.calls[0][1];
    expect(matcher({ firmId: "f1", clientId: "c1" })).toBe(true);
    expect(matcher({ firmId: "f1", clientId: "c2" })).toBe(false);
    // A client sync must NOT cancel a firm-level (clientId null) pending job.
    expect(matcher({ firmId: "f1" })).toBe(false);
  });
  it("never throws if the queue errors", async () => {
    mockEnqueue.mockRejectedValueOnce(new Error("queue down"));
    await expect(enqueueQuickbooksSync("f1")).resolves.toBeUndefined();
  });
});
