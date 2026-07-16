import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { pollIntervalFor, isReviewSettled, ItemCard } from "./item-card";
import { deriveItemStatus, type FileReview } from "@/lib/review/rollup";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";
import type { SetAssessment } from "@/lib/ai/set-assessment";
import type { PortalFile } from "@/lib/db/portal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The verdict-poll schedule: fast while the AI usually answers (seconds),
// then backed off but STILL listening — the durable fallback is a cron that
// retries every 2 minutes, and the old hard 30s cutoff meant a slow verdict
// only appeared after a manual page reload.
describe("pollIntervalFor", () => {
  it("polls fast (1.5s) for the first 30 seconds", () => {
    expect(pollIntervalFor(0)).toBe(1_500);
    expect(pollIntervalFor(29_999)).toBe(1_500);
  });

  it("backs off to 5s until 2 minutes", () => {
    expect(pollIntervalFor(30_000)).toBe(5_000);
    expect(pollIntervalFor(119_999)).toBe(5_000);
  });

  it("slows to 15s until 10 minutes — covering several cron retries", () => {
    expect(pollIntervalFor(120_000)).toBe(15_000);
    expect(pollIntervalFor(599_999)).toBe(15_000);
  });

  it("gives up after 10 minutes (the email/SMS fallback takes over)", () => {
    expect(pollIntervalFor(600_000)).toBeNull();
    expect(pollIntervalFor(3_600_000)).toBeNull();
  });
});

// A settled line must not keep asking the client for anything: the card would
// contradict itself ("Approved" + "please send page 4").
describe("isReviewSettled", () => {
  it("is settled once the accountant approved, or the client said N/A", () => {
    expect(isReviewSettled("approved")).toBe(true);
    expect(isReviewSettled("na")).toBe(true);
  });

  it("is NOT settled while the line is still live", () => {
    expect(isReviewSettled("pending")).toBe(false);
    expect(isReviewSettled("submitted")).toBe(false);
    expect(isReviewSettled("rejected")).toBe(false);
  });
});

// The portal's suppression rule and the roll-up's precedence are two halves of
// the same rule and must not drift apart: deriveItemStatus decides that an
// approval OUTRANKS an outstanding missing-page ask, and isReviewSettled is
// what makes the portal render that decision. These drive both together over
// the real bug: the AI concluded a page was missing and the accountant approved
// the file anyway (the legitimate override — "I don't need page 4").
describe("an AI missing-page ask vs. the accountant's override", () => {
  // When the AI concluded "page 4 of 4 is missing" and asked the client.
  const assessedAt = "2026-05-01T10:05:00Z";
  const uploadedAt = "2026-05-01T10:00:00Z";

  it("suppresses the ask once the accountant approves the file anyway", () => {
    const approved: FileReview[] = [
      {
        review_status: "approved",
        uploaded_at: uploadedAt,
        reviewed_at: "2026-05-02T09:00:00Z",
      },
    ];
    // The approval outranks the ask — no newer upload ever arrived.
    const status = deriveItemStatus(approved, {
      setNeedsClientSince: assessedAt,
    });
    expect(status).toBe("approved");
    expect(isReviewSettled(status)).toBe(true);
  });

  it("still shows the ask while the client genuinely owes the page", () => {
    const awaitingPage: FileReview[] = [
      { review_status: "pending", uploaded_at: uploadedAt, reviewed_at: null },
    ];
    const status = deriveItemStatus(awaitingPage, {
      setNeedsClientSince: assessedAt,
    });
    expect(status).toBe("rejected");
    expect(isReviewSettled(status)).toBe(false);
  });
});

// The bug as the CLIENT hit it, driven through the real card: the rule above is
// only worth anything if the render actually honours it.
const MISSING_PAGE_ASK =
  "Page 4 of 4 is missing from your May 2026 bank statement. Could you please upload it?";

const INCOMPLETE_SET: SetAssessment = {
  conclusion_en: "Pages 1-3 of 4 received; page 4 is missing.",
  conclusion_fr: "Pages 1 à 3 sur 4 reçues; la page 4 est manquante.",
  confidence: 0.96,
  outcome: "incomplete",
  client_request_en: MISSING_PAGE_ASK,
  client_request_fr:
    "La page 4 de 4 de votre relevé bancaire de mai 2026 est manquante. Pourriez-vous la téléverser?",
  needs_client: true,
  pages: [],
  flags: [],
  assessed_at: "2026-05-01T10:05:00Z",
  files_signature: [],
};

const ITEM: RequestItem = {
  id: "48c4c019-fea3-4f9d-978a-8481abe87a95",
  engagement_id: "82350dcb-36cf-423d-8fa2-0a0df1b85d95",
  label: "Bank statements May 2026",
  label_fr: null,
  description: null,
  description_fr: null,
  doc_type: "other",
  required: true,
  order_index: 0,
  status: "rejected",
  approved_by: null,
  approved_at: null,
  rejection_reason: null,
  ai_rejection_count: 0,
  kind: "collection",
  signing_doc_path: null,
  signing_doc_name: null,
  signing_doc_mime: null,
  ai_set_assessment: INCOMPLETE_SET,
  created_at: "2026-05-01T09:00:00Z",
};

const FILE: PortalFile = {
  id: "f1",
  name: "may-2026-statement.pdf",
  status: "pending",
  reason: null,
  mime: "application/pdf",
  url: null,
};

function renderCard(status: RequestItemStatus, file: Partial<PortalFile> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ItemCard
        token="tok_test"
        item={{ ...ITEM, status }}
        locale="en"
        uploadedCount={1}
        files={[{ ...FILE, ...file }]}
        rejection={null}
        autoRequestMissingPages
        onUploaded={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("ItemCard — the AI's missing-page ask on the client portal", () => {
  it("asks for the missing page while the item is still waiting on the client", () => {
    renderCard("rejected");
    expect(screen.getByText(MISSING_PAGE_ASK)).toBeInTheDocument();
  });

  // The reported bug: the accountant overrode the AI ("I don't need page 4") and
  // approved. The client's card said "Approved" / "All set, thank you!" AND
  // "Page 4 of 4 is missing... could you please upload it?" at the same time.
  it("drops the ask once the accountant approved the file anyway", () => {
    renderCard("approved", { status: "approved" });
    expect(screen.queryByText(MISSING_PAGE_ASK)).not.toBeInTheDocument();
    // ...and the card commits to the approval, with nothing left to contradict it.
    expect(screen.getByText(en.Portal.status_approved)).toBeInTheDocument();
    expect(screen.getByText(en.Portal.status_all_set)).toBeInTheDocument();
    expect(
      screen.queryByText(en.Portal.status_needs_attention),
    ).not.toBeInTheDocument();
  });

  it("drops the ask once the client marked the line not-applicable", () => {
    renderCard("na");
    expect(screen.queryByText(MISSING_PAGE_ASK)).not.toBeInTheDocument();
    expect(screen.getByText(en.Portal.status_na)).toBeInTheDocument();
  });
});
