import { describe, it, expect, vi, beforeEach } from "vitest";

// Live posting used to be gated to Xero DEMO companies (isClientXeroDemoOrg).
// The founder lifted that gate, so a REAL client's org must post like any other.
//
// The regression guard is the shape of this @/lib/db/xero mock: it deliberately
// does NOT export a demo-org helper. Re-introducing a demo check in post.ts would
// import `undefined` from here and throw on call, so the gate cannot come back
// silently — and the "real org posts" assertion below would fail loudly.
vi.mock("@/lib/db/xero", () => ({
  isClientXeroConnected: vi.fn(async () => true),
  readClientXeroPublishDefault: vi.fn(async () => null),
  readClientXeroBaseCurrency: vi.fn(async () => "CAD"),
}));
vi.mock("@/lib/db/quickbooks-suggestions", () => ({
  getDraftForFile: vi.fn(),
  recordDraftPosted: vi.fn(async () => "ok"),
  recordDraftPostError: vi.fn(),
  recordDraftTaxNote: vi.fn(),
  recordReceiptAttached: vi.fn(),
  recordDraftVoided: vi.fn(),
  recordDraftMatched: vi.fn(async () => "ok"),
  listFirmPostedQboIds: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/lib/db/xero-cache", () => ({ readXeroPostingContext: vi.fn() }));
vi.mock("@/lib/xero/connection", () => ({ getXeroReadContext: vi.fn() }));
vi.mock("@/lib/xero/client", () => ({
  XeroError: class XeroError extends Error {
    code = "test";
    status?: number;
  },
}));
vi.mock("@/lib/xero/write", () => ({
  xeroCreateInvoice: vi.fn(),
  xeroCreateBankTransaction: vi.fn(),
  xeroSetInvoiceStatus: vi.fn(),
  xeroDeleteBankTransaction: vi.fn(),
  xeroUploadAttachment: vi.fn(),
}));
// No transaction already in the books — the pre-create duplicate check finds
// nothing, so posting proceeds to a create. (register-match has its own suite.)
vi.mock("@/lib/xero/register-match", () => ({
  searchXeroRegister: vi.fn(async () => ({ candidates: [], readFailed: false })),
  checkXeroRegister: vi.fn(async () => ({
    verdict: { kind: "none" },
    candidates: [],
  })),
  xeroSearchEntities: vi.fn(() => ["bill"]),
}));
vi.mock("@/lib/db/uploaded-files", () => ({ getUploadedFileById: vi.fn() }));
vi.mock("@/lib/storage", () => ({ downloadObject: vi.fn() }));
vi.mock("@/lib/quickbooks/post", () => ({ postApprovedDraft: vi.fn() }));

import { postApprovedXeroDraft } from "./post";
import {
  getDraftForFile,
  recordDraftPosted,
} from "@/lib/db/quickbooks-suggestions";
import { readXeroPostingContext } from "@/lib/db/xero-cache";
import { getXeroReadContext } from "@/lib/xero/connection";
import { xeroCreateInvoice } from "@/lib/xero/write";
import { getUploadedFileById } from "@/lib/db/uploaded-files";

const mockGetDraft = vi.mocked(getDraftForFile);
const mockPctx = vi.mocked(readXeroPostingContext);
const mockCtx = vi.mocked(getXeroReadContext);
const mockCreateInvoice = vi.mocked(xeroCreateInvoice);
const mockRecordPosted = vi.mocked(recordDraftPosted);
const mockGetFile = vi.mocked(getUploadedFileById);

const VENDOR = { id: "vendor-1", name: "Bell Canada" };
const ACCOUNT = { id: "account-1", name: "Telephone" };

function field(match: { id: string; name: string } | null) {
  return { match, confidence: match ? 1 : 0, candidates: [] };
}

// An approved, fully-mapped UNPAID EXPENSE — the simplest postable draft (an
// ACCPAY bill: no bank account required).
function draft(over: Record<string, unknown> = {}) {
  return {
    engagementId: "eng-1",
    clientId: "client-1",
    firmId: "firm-1",
    resolved: null,
    suggestion: {
      direction: "expense",
      partyKind: "vendor",
      party: field(VENDOR),
      account: field(ACCOUNT),
      taxCode: field(null),
      amount: 113,
      subtotal: 113,
      taxTotal: null,
      paid: false,
      date: "2026-07-10",
      reference: "INV-42",
      currency: "CAD",
      partySource: "Bell Canada",
      lines: [],
    },
    status: "approved",
    postedQboId: null,
    postedSyncToken: null,
    postAttempt: 0,
    postReady: true,
    receiptAttachedAt: null,
    attachReady: true,
    matchedQboType: null,
    matchReady: true,
    provider: "xero",
    postedStatus: null,
    ...over,
  };
}

describe("postApprovedXeroDraft — real (non-demo) organisations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetDraft.mockResolvedValue(draft() as any);
    mockCtx.mockResolvedValue({
      accessToken: "tok",
      tenantId: "tenant-real-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mockPctx.mockResolvedValue({
      lists: {
        vendors: [{ ...VENDOR, active: true }],
        accounts: [{ ...ACCOUNT, active: true }],
      },
      accountCodeById: new Map([[ACCOUNT.id, "489"]]),
      itemCodeById: new Map(),
      itemIncomeAccountCodeById: new Map(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mockCreateInvoice.mockResolvedValue({
      id: "xero-inv-1",
      total: 113,
      totalTax: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mockRecordPosted.mockResolvedValue("ok");
    mockGetFile.mockResolvedValue(null); // skip the best-effort receipt attach
  });

  // THE GATE-LIFT TEST. Before this change a real org returned not_postable with
  // "enabled for Xero Demo companies only"; nothing about the draft has to change
  // for it to post now.
  it("posts a bill for an organisation that is not a Xero Demo company", async () => {
    const r = await postApprovedXeroDraft("file-1", "user-1");

    expect(r.kind).toBe("posted");
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
  });

  it("records the org it posted under so undo can retract it", async () => {
    await postApprovedXeroDraft("file-1", "user-1");

    expect(mockRecordPosted).toHaveBeenCalledWith(
      expect.objectContaining({
        postedQboId: "xero-inv-1",
        postedRealmId: "tenant-real-1",
        postedStatus: "AUTHORISED",
      }),
    );
  });

  // The gate returned `not_postable` with an empty `problems` array — a shape no
  // real postability failure produces. Asserting it never comes back catches a
  // re-added gate even if it is worded differently.
  it("never refuses with an empty problems list (the old demo-gate shape)", async () => {
    const r = await postApprovedXeroDraft("file-1", "user-1");

    expect(r).not.toMatchObject({ kind: "not_postable", problems: [] });
  });

  // Real postability checks must still bite — lifting the gate widened WHO can
  // post, not WHAT is allowed through.
  it("still refuses a draft whose direction is unknown", async () => {
    mockGetDraft.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      draft({ suggestion: { ...draft().suggestion, direction: "unknown" } }) as any,
    );

    const r = await postApprovedXeroDraft("file-1", "user-1");

    expect(r).toMatchObject({ kind: "not_postable", problems: ["not_expense"] });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it("still refuses when the expense account has no Xero code", async () => {
    mockPctx.mockResolvedValue({
      lists: {
        vendors: [{ ...VENDOR, active: true }],
        accounts: [{ ...ACCOUNT, active: true }],
      },
      accountCodeById: new Map(), // no code for the mapped account
      itemCodeById: new Map(),
      itemIncomeAccountCodeById: new Map(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const r = await postApprovedXeroDraft("file-1", "user-1");

    expect(r).toMatchObject({
      kind: "not_postable",
      problems: ["missing_account"],
    });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });
});
