import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate attachReceiptToPostedDraft from storage / QuickBooks / DB. Mock every
// impure module post.ts pulls in so importing it never touches Supabase or the
// network (mirrors sync.test.ts's approach).
vi.mock("@/lib/db/quickbooks-suggestions", () => ({
  getDraftForFile: vi.fn(),
  recordDraftPosted: vi.fn(),
  recordDraftPostError: vi.fn(),
  recordDraftTaxNote: vi.fn(),
  recordReceiptAttached: vi.fn(),
}));
vi.mock("@/lib/quickbooks/connection", () => ({
  getQuickbooksReadContext: vi.fn(),
}));
vi.mock("@/lib/db/quickbooks-cache", () => ({
  readCachedQuickbooksLists: vi.fn(),
}));
vi.mock("@/lib/db/uploaded-files", () => ({ getUploadedFileById: vi.fn() }));
vi.mock("@/lib/storage", () => ({ downloadObject: vi.fn() }));
vi.mock("@/lib/quickbooks/client", () => {
  class QuickbooksError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    QuickbooksError,
    quickbooksUploadAttachment: vi.fn(),
    quickbooksCreate: vi.fn(),
    quickbooksTaxLinesEnabled: vi.fn(() => false),
  };
});

import { attachReceiptToPostedDraft } from "./post";
import { recordReceiptAttached } from "@/lib/db/quickbooks-suggestions";
import { getUploadedFileById } from "@/lib/db/uploaded-files";
import { downloadObject } from "@/lib/storage";
import {
  quickbooksUploadAttachment,
  QuickbooksError,
} from "@/lib/quickbooks/client";

const mockGetFile = vi.mocked(getUploadedFileById);
const mockDownload = vi.mocked(downloadObject);
const mockUpload = vi.mocked(quickbooksUploadAttachment);
const mockRecord = vi.mocked(recordReceiptAttached);

// Minimal read context — it's passed straight through to the (mocked) upload, so
// the shape doesn't matter beyond being an object.
const ctx = { accessToken: "t", realmId: "r" } as never;
const FILE = {
  storagePath: "firm/receipt.pdf",
  mimeType: "application/pdf",
  fileName: "receipt.pdf",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("attachReceiptToPostedDraft", () => {
  it("attaches the receipt and records the outcome on success", async () => {
    mockGetFile.mockResolvedValue(FILE);
    mockDownload.mockResolvedValue(Buffer.from("pdf-bytes"));
    mockUpload.mockResolvedValue(undefined);

    const r = await attachReceiptToPostedDraft({
      ctx,
      entity: "bill",
      fileId: "file-1",
      postedQboId: "145",
    });

    expect(r).toEqual({ kind: "attached" });
    expect(mockUpload).toHaveBeenCalledWith(ctx, "bill", "145", {
      bytes: expect.any(Buffer),
      fileName: "receipt.pdf",
      mime: "application/pdf",
    });
    // The record is stamped so the card can show "Receipt attached" and the retry
    // disappears — keyed to the SAME posted transaction (guards a concurrent void).
    expect(mockRecord).toHaveBeenCalledWith({
      uploadedFileId: "file-1",
      postedQboId: "145",
    });
  });

  it("fails without recording when the source document is gone", async () => {
    mockGetFile.mockResolvedValue(null);

    const r = await attachReceiptToPostedDraft({
      ctx,
      entity: "invoice",
      fileId: "file-2",
      postedQboId: "200",
    });

    expect(r.kind).toBe("failed");
    expect(r.detail).toMatch(/not found/i);
    expect(mockUpload).not.toHaveBeenCalled();
    // Nothing attached → nothing recorded, so the card keeps offering the retry.
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns the QuickBooks error detail and does not record on upload failure", async () => {
    mockGetFile.mockResolvedValue(FILE);
    mockDownload.mockResolvedValue(Buffer.from("pdf-bytes"));
    mockUpload.mockRejectedValue(
      new QuickbooksError("request_failed", "Unsupported attachment type"),
    );

    const r = await attachReceiptToPostedDraft({
      ctx,
      entity: "purchase",
      fileId: "file-3",
      postedQboId: "300",
    });

    expect(r.kind).toBe("failed");
    expect(r.detail).toBe("Unsupported attachment type");
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
