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
  listFirmPostedQboIds: vi.fn(),
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
vi.mock("@/lib/quickbooks/register-match", () => ({
  findRegisterCandidates: vi.fn(),
  classifyRegisterMatch: vi.fn(),
  REGISTER_MATCH_WINDOW_DAYS: 5,
}));

import { attachReceiptToPostedDraft, postApprovedDraft } from "./post";
import {
  getDraftForFile,
  recordDraftPosted,
  recordDraftTaxNote,
  recordReceiptAttached,
  listFirmPostedQboIds,
} from "@/lib/db/quickbooks-suggestions";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import {
  findRegisterCandidates,
  classifyRegisterMatch,
  type RegisterCandidate,
} from "@/lib/quickbooks/register-match";
import { getUploadedFileById } from "@/lib/db/uploaded-files";
import { downloadObject } from "@/lib/storage";
import {
  quickbooksUploadAttachment,
  quickbooksCreate,
  QuickbooksError,
} from "@/lib/quickbooks/client";

const mockGetFile = vi.mocked(getUploadedFileById);
const mockDownload = vi.mocked(downloadObject);
const mockUpload = vi.mocked(quickbooksUploadAttachment);
const mockRecord = vi.mocked(recordReceiptAttached);
const mockGetDraft = vi.mocked(getDraftForFile);
const mockRecordPosted = vi.mocked(recordDraftPosted);
const mockTaxNote = vi.mocked(recordDraftTaxNote);
const mockListPostedIds = vi.mocked(listFirmPostedQboIds);
const mockReadCtx = vi.mocked(getQuickbooksReadContext);
const mockLists = vi.mocked(readCachedQuickbooksLists);
const mockFind = vi.mocked(findRegisterCandidates);
const mockClassify = vi.mocked(classifyRegisterMatch);
const mockCreate = vi.mocked(quickbooksCreate);

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

// ── Smart match-or-create (part 3) ──────────────────────────────────────────

// A minimal fully-postable unpaid EXPENSE draft (posts a Bill): party + account
// matched, no tax on the document, valid ISO date. Tax lines are OFF in the
// client mock, so no tax application is attempted.
const SUGGESTION = {
  direction: "expense",
  partyKind: "vendor",
  party: {
    match: { id: "V1", name: "Tim Hortons", active: true },
    confidence: 0.9,
    candidates: [],
  },
  account: {
    match: { id: "A1", name: "Meals", active: true },
    confidence: 0.9,
    candidates: [],
  },
  taxCode: { match: null, confidence: 0, candidates: [] },
  amount: 45.2,
  subtotal: null,
  taxTotal: null,
  date: "2026-07-01",
  currency: "CAD",
  partySource: "TIM HORTONS #4821",
  overallConfidence: 0.8,
  notes: [],
} as never;

const DRAFT = {
  engagementId: "e1",
  firmId: "f1",
  suggestion: SUGGESTION,
  resolved: null,
  status: "approved",
  postReady: true,
  postedQboId: null,
  postedSyncToken: null,
  postAttempt: 0,
  receiptAttachedAt: null,
  attachReady: true,
  matchedQboType: null,
  matchReady: true,
} as never;

const READ_CTX = {
  accessToken: "t",
  realmId: "r",
  environment: "sandbox",
  companyCountry: "CA",
} as never;

const CANDIDATE: RegisterCandidate = {
  qboId: "900",
  entity: "purchase",
  txnDate: "2026-07-03",
  totalAmt: 45.2,
  docNumber: null,
  vendorId: "V1",
  vendorName: "Tim Hortons",
  syncToken: "3",
  currency: null,
};

// A minimal fully-postable PAID INCOME draft (posts a SalesReceipt): customer +
// item matched, no tax on the document, valid ISO date, paid=true.
const INCOME_SUGGESTION = {
  direction: "income",
  partyKind: "customer",
  party: {
    match: { id: "C1", name: "Lumen Studio", active: true },
    confidence: 0.9,
    candidates: [],
  },
  account: { match: null, confidence: 0, candidates: [] },
  item: {
    match: { id: "I1", name: "Consulting", active: true },
    confidence: 0.9,
    candidates: [],
  },
  taxCode: { match: null, confidence: 0, candidates: [] },
  amount: 320,
  subtotal: null,
  taxTotal: null,
  date: "2026-07-02",
  currency: "CAD",
  paid: true,
  partySource: "Lumen Studio",
  overallConfidence: 0.85,
  notes: [],
} as never;

const INCOME_DRAFT = {
  engagementId: "e1",
  firmId: "f1",
  suggestion: INCOME_SUGGESTION,
  resolved: null,
  status: "approved",
  postReady: true,
  postedQboId: null,
  postedSyncToken: null,
  postAttempt: 0,
  receiptAttachedAt: null,
  attachReady: true,
  matchedQboType: null,
  matchReady: true,
} as never;

function primePostableDraft() {
  mockGetDraft.mockResolvedValue(DRAFT);
  mockLists.mockResolvedValue(null);
  mockReadCtx.mockResolvedValue(READ_CTX);
  mockListPostedIds.mockResolvedValue(new Set());
  mockRecordPosted.mockResolvedValue("ok");
  mockTaxNote.mockResolvedValue(undefined);
  // The receipt-attach inside the matched/created paths.
  mockGetFile.mockResolvedValue(FILE);
  mockDownload.mockResolvedValue(Buffer.from("pdf-bytes"));
  mockUpload.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue({ id: "500", syncToken: "0" });
}

describe("postApprovedDraft — smart match-or-create", () => {
  beforeEach(() => {
    primePostableDraft();
  });

  it("attaches to the existing transaction on a CLEAR match and creates nothing", async () => {
    mockFind.mockResolvedValue({ candidates: [CANDIDATE], truncated: false });
    mockClassify.mockReturnValue({ kind: "clear", candidate: CANDIDATE });

    const r = await postApprovedDraft("file-1", "user-1");

    expect(r.kind).toBe("matched_existing");
    expect(r.postedQboId).toBe("900");
    expect(mockCreate).not.toHaveBeenCalled();
    // Recorded like a post but with the matched marker (the void route relies
    // on it to unlink instead of deleting).
    expect(mockRecordPosted).toHaveBeenCalledWith({
      uploadedFileId: "file-1",
      expectedAttempt: 0,
      postedQboId: "900",
      postedSyncToken: "3",
      posterId: "user-1",
      matchedQboType: "purchase",
      // Stamped with the live realm so the exclusion set stays company-scoped.
      postedRealmId: "r",
    });
    // The receipt lands on the MATCHED transaction (its entity, not the draft's).
    expect(mockUpload).toHaveBeenCalledWith(READ_CTX, "purchase", "900", {
      bytes: expect.any(Buffer),
      fileName: "receipt.pdf",
      mime: "application/pdf",
    });
    // Both expense registers are searched regardless of the draft's own mode.
    expect(mockFind).toHaveBeenCalledWith(
      READ_CTX,
      expect.objectContaining({
        entities: ["bill", "purchase"],
        date: "2026-07-01",
        amount: 45.2,
      }),
    );
  });

  it("asks the accountant on an uncertain match and writes nothing", async () => {
    mockFind.mockResolvedValue({
      candidates: [CANDIDATE, { ...CANDIDATE, qboId: "901" }],
      truncated: false,
    });
    mockClassify.mockReturnValue({ kind: "confirm" });

    const r = await postApprovedDraft("file-1", "user-1");

    expect(r.kind).toBe("needs_match_confirmation");
    expect(r.matchCandidates?.map((c) => c.qboId)).toEqual(["900", "901"]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecordPosted).not.toHaveBeenCalled();
  });

  it("FAILS OPEN to a normal create when the register read errors", async () => {
    mockFind.mockRejectedValue(
      new QuickbooksError("read_failed", "QuickBooks query failed (500)"),
    );

    const r = await postApprovedDraft("file-1", "user-1");

    expect(r.kind).toBe("posted");
    expect(r.postedQboId).toBe("500");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("skips matching entirely when the accountant chose 'post a new one'", async () => {
    mockClassify.mockReturnValue({ kind: "clear", candidate: CANDIDATE });

    const r = await postApprovedDraft("file-1", "user-1", {
      match: { action: "create" },
    });

    expect(r.kind).toBe("posted");
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("skips matching pre-migration (matchReady false)", async () => {
    mockGetDraft.mockResolvedValue({
      ...(DRAFT as Record<string, unknown>),
      matchReady: false,
    } as never);

    const r = await postApprovedDraft("file-1", "user-1");

    expect(r.kind).toBe("posted");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("skips matching when the Vylan-posted exclusion list can't be read", async () => {
    mockListPostedIds.mockResolvedValue(null);

    const r = await postApprovedDraft("file-1", "user-1");

    expect(r.kind).toBe("posted");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("attaches to the accountant's confirmed pick after re-validating it", async () => {
    mockFind.mockResolvedValue({ candidates: [CANDIDATE], truncated: false });

    const r = await postApprovedDraft("file-1", "user-1", {
      match: { action: "attach", qboId: "900" },
    });

    expect(r.kind).toBe("matched_existing");
    expect(r.postedQboId).toBe("900");
    // The explicit pick bypasses classification (the accountant decided).
    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("attaches to the picked ENTITY when a Bill and Purchase share the same id", async () => {
    // QBO ids are unique only per type; a Bill#900 and a Purchase#900 can both
    // match the amount+window. The accountant picked the Purchase — matching on
    // id alone would wrongly attach to the Bill (searched first).
    const bill900: RegisterCandidate = {
      ...CANDIDATE,
      entity: "bill",
      syncToken: "7",
    };
    const purchase900: RegisterCandidate = {
      ...CANDIDATE,
      entity: "purchase",
      syncToken: "8",
    };
    mockFind.mockResolvedValue({
      candidates: [bill900, purchase900],
      truncated: false,
    });

    const r = await postApprovedDraft("file-1", "user-1", {
      match: { action: "attach", qboId: "900", entity: "purchase" },
    });

    expect(r.kind).toBe("matched_existing");
    expect(mockCreate).not.toHaveBeenCalled();
    // Attached to the Purchase (its syncToken + entity), not the Bill.
    expect(mockRecordPosted).toHaveBeenCalledWith(
      expect.objectContaining({
        postedQboId: "900",
        postedSyncToken: "8",
        matchedQboType: "purchase",
      }),
    );
    expect(mockUpload).toHaveBeenCalledWith(
      READ_CTX,
      "purchase",
      "900",
      expect.anything(),
    );
  });

  it("re-asks when the accountant's pick is no longer a valid candidate", async () => {
    mockFind.mockResolvedValue({ candidates: [], truncated: false });

    const r = await postApprovedDraft("file-1", "user-1", {
      match: { action: "attach", qboId: "900" },
    });

    expect(r.kind).toBe("needs_match_confirmation");
    expect(r.matchCandidates).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecordPosted).not.toHaveBeenCalled();
  });

  it("an explicit ATTACH FAILS CLOSED (never creates) when the exclusion read is unavailable", async () => {
    // The accountant said "this is already in QuickBooks"; a transient DB blip
    // must NOT silently create the duplicate they were avoiding.
    mockListPostedIds.mockResolvedValue(null);

    const r = await postApprovedDraft("file-1", "user-1", {
      match: { action: "attach", qboId: "900" },
    });

    expect(r.kind).toBe("post_failed");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecordPosted).not.toHaveBeenCalled();
  });

  it("an explicit ATTACH FAILS CLOSED (never creates) when the re-validation search errors", async () => {
    mockFind.mockRejectedValue(
      new QuickbooksError("read_failed", "QuickBooks query failed (500)"),
    );

    const r = await postApprovedDraft("file-1", "user-1", {
      match: { action: "attach", qboId: "900" },
    });

    expect(r.kind).toBe("post_failed");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecordPosted).not.toHaveBeenCalled();
  });

  it("creates normally when there is no match at all", async () => {
    mockFind.mockResolvedValue({ candidates: [], truncated: false });
    mockClassify.mockReturnValue({ kind: "none" });

    const r = await postApprovedDraft("file-1", "user-1");

    expect(r.kind).toBe("posted");
    expect(r.postedQboId).toBe("500");
    expect(mockRecordPosted).toHaveBeenCalledWith(
      expect.not.objectContaining({ matchedQboType: expect.anything() }),
    );
  });
});

describe("postApprovedDraft — income posts a SalesReceipt vs an Invoice", () => {
  beforeEach(() => {
    primePostableDraft();
    mockGetDraft.mockResolvedValue(INCOME_DRAFT);
    // No existing match → a clean create for both cases below.
    mockFind.mockResolvedValue({ candidates: [], truncated: false });
    mockClassify.mockReturnValue({ kind: "none" });
  });

  it("creates a SalesReceipt (not an Invoice) for a PAID sale and attaches to it", async () => {
    const r = await postApprovedDraft("file-9", "user-1");

    expect(r.kind).toBe("posted");
    expect(r.postedQboId).toBe("500");
    // The paid sale posts as a SalesReceipt, under the fileId-attempt requestid.
    expect(mockCreate).toHaveBeenCalledWith(
      READ_CTX,
      "salesreceipt",
      expect.any(Object),
      "file-9-0",
    );
    // Both income registers are searched for a duplicate (Invoice + SalesReceipt).
    expect(mockFind).toHaveBeenCalledWith(
      READ_CTX,
      expect.objectContaining({ entities: ["invoice", "salesreceipt"] }),
    );
    // The source document lands on the SalesReceipt that was just created.
    expect(mockUpload).toHaveBeenCalledWith(
      READ_CTX,
      "salesreceipt",
      "500",
      expect.anything(),
    );
  });

  it("posts an Invoice when the SAME sale is left UNPAID", async () => {
    mockGetDraft.mockResolvedValue({
      ...(INCOME_DRAFT as Record<string, unknown>),
      suggestion: {
        ...(INCOME_SUGGESTION as Record<string, unknown>),
        paid: false,
      },
    } as never);

    const r = await postApprovedDraft("file-9", "user-1");

    expect(r.kind).toBe("posted");
    expect(mockCreate).toHaveBeenCalledWith(
      READ_CTX,
      "invoice",
      expect.any(Object),
      "file-9-0",
    );
  });
});
