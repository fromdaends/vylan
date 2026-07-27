import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  buildFinalCandidate,
  isInvoiceAttachmentPath,
  type EngagementContext,
  type UploadedRow,
} from "./runner";

const ENG: EngagementContext = {
  engagementId: "eng-1",
  title: "T1 2024",
  dueDate: "2025-04-30",
  taxYear: 2024,
  clientName: "Marie Tremblay",
  clientType: "individual",
  firmName: "Cabinet Vylan",
};

function upload(over: Partial<UploadedRow> = {}): UploadedRow {
  return {
    id: "file-1",
    storage_path: "firm/eng/file.pdf",
    original_filename: "IMG_1.pdf",
    mime_type: "application/pdf",
    review_status: "approved",
    is_duplicate: false,
    ai_classification: "t4",
    ai_confidence: 0.9,
    ai_extracted_fields: {
      extracted_year: 2023,
      issuer_name: "Hydro-Québec",
      party_name: "Marie Tremblay",
      account_or_period: null,
      document_date: "2024-02-28",
    },
    uploaded_at: "2025-03-01T12:00:00Z",
    ...over,
  };
}

describe("buildCandidate", () => {
  it("threads classification fields into doc + token context", () => {
    const { doc, tokenContext } = buildCandidate(upload(), ENG);
    expect(doc).toMatchObject({
      source: "checklist",
      fileId: "file-1",
      engagementId: "eng-1",
      reviewStatus: "approved",
      docTypeCode: "t4",
      extractedYear: 2023,
      issuerName: "Hydro-Québec",
    });
    // The document's own year beats the engagement tax year.
    expect(tokenContext.year).toBe(2023);
    expect(tokenContext.date).toBe("2024-02-28");
    expect(tokenContext.clientName).toBe("Marie Tremblay");
  });

  it("falls back doc year -> tax year -> title -> due date", () => {
    const noDocYear = upload({
      ai_extracted_fields: { extracted_year: null },
    });
    expect(buildCandidate(noDocYear, ENG).tokenContext.year).toBe(2024);
    expect(
      buildCandidate(noDocYear, { ...ENG, taxYear: null }).tokenContext.year,
    ).toBe(2024); // title "T1 2024"
    expect(
      buildCandidate(noDocYear, {
        ...ENG,
        taxYear: null,
        title: "Bookkeeping",
      }).tokenContext.year,
    ).toBe(2025); // due date
  });

  it("uses the upload date when no document date was read", () => {
    const row = upload({ ai_extracted_fields: {} });
    expect(buildCandidate(row, ENG).tokenContext.date).toBe("2025-03-01");
  });

  it("survives null extracted fields entirely", () => {
    const row = upload({ ai_extracted_fields: null, ai_classification: null, ai_confidence: null });
    const { doc, tokenContext } = buildCandidate(row, ENG);
    expect(doc.issuerName).toBeNull();
    expect(tokenContext.docTypeCode).toBeNull();
  });
});

describe("buildFinalCandidate", () => {
  it("builds an unclassified final-source candidate on the engagement year", () => {
    const { doc, tokenContext } = buildFinalCandidate(
      {
        id: "fin-1",
        storage_path: "firm/eng/final.pdf",
        original_filename: "Declaration 2024.pdf",
        mime_type: "application/pdf",
        created_at: "2025-05-01T09:00:00Z",
      },
      ENG,
    );
    expect(doc.source).toBe("final");
    expect(doc.reviewStatus).toBeNull();
    expect(tokenContext.year).toBe(2024);
    expect(tokenContext.date).toBe("2025-05-01");
  });
});

describe("isInvoiceAttachmentPath", () => {
  it("flags invoice attachment paths and nothing else", () => {
    expect(isInvoiceAttachmentPath("firm/eng/invoices/inv-1.pdf")).toBe(true);
    expect(isInvoiceAttachmentPath("firm/eng/final.pdf")).toBe(false);
    expect(isInvoiceAttachmentPath(null)).toBe(false);
  });
});
