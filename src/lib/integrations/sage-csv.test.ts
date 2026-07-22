import { describe, it, expect } from "vitest";
import {
  bucketTaxes,
  toSageCsvRow,
  buildSageCsv,
  sageCsvFilename,
  SAGE_CSV_COLUMNS,
  type SageCsvRow,
} from "./sage-csv";
import type { TransactionExtraction } from "@/lib/ai/transaction-extract";

const txn = (over: Partial<TransactionExtraction>): TransactionExtraction => ({
  direction: "expense",
  vendor_name: null,
  customer_name: null,
  document_date: null,
  document_number: null,
  currency: null,
  subtotal: null,
  total: null,
  taxes: [],
  line_items: [],
  paid: null,
  payment_method: null,
  confidence: 0.9,
  notes: null,
  ...over,
});

describe("bucketTaxes", () => {
  it("splits Quebec GST/TPS and QST/TVQ into their own columns", () => {
    expect(
      bucketTaxes([
        { type: "TPS", amount: 5 },
        { type: "TVQ", amount: 9.98 },
      ]),
    ).toEqual({ gstHst: 5, qst: 9.98 });
    expect(
      bucketTaxes([
        { type: "GST", amount: 5 },
        { type: "QST", amount: 9.98 },
      ]),
    ).toEqual({ gstHst: 5, qst: 9.98 });
  });

  it("puts Ontario HST in the GST/HST column and leaves QST null", () => {
    expect(bucketTaxes([{ type: "HST", amount: 260 }])).toEqual({
      gstHst: 260,
      qst: null,
    });
  });

  it("returns null columns when there are no taxes", () => {
    expect(bucketTaxes([])).toEqual({ gstHst: null, qst: null });
  });
});

describe("toSageCsvRow", () => {
  const ctx = {
    documentType: "receipt",
    client: "Acme Corp",
    engagement: "Year-End 2025",
    link: "https://vylan.app/x",
  };

  it("uses the vendor for an expense and joins line items into the description", () => {
    const row = toSageCsvRow(
      txn({
        direction: "expense",
        vendor_name: "Quincaillerie Mont-Royal",
        subtotal: 100,
        total: 114.98,
        taxes: [
          { type: "TPS", amount: 5, rate: 5 },
          { type: "TVQ", amount: 9.98, rate: 9.975 },
        ],
        line_items: [
          { description: "Perceuse", amount: 79.99 },
          { description: "Ruban", amount: 12.99 },
        ],
        currency: "CAD",
        document_date: "2026-06-15",
        document_number: null,
      }),
      ctx,
    );
    expect(row.direction).toBe("Expense");
    expect(row.vendorOrPayee).toBe("Quincaillerie Mont-Royal");
    expect(row.gstHst).toBe(5);
    expect(row.qst).toBe(9.98);
    expect(row.description).toBe("Perceuse; Ruban");
    expect(row.subtotal).toBe(100);
    expect(row.total).toBe(114.98);
  });

  it("uses the customer for income", () => {
    const row = toSageCsvRow(
      txn({ direction: "income", customer_name: "Boulangerie du Coin" }),
      ctx,
    );
    expect(row.direction).toBe("Income");
    expect(row.vendorOrPayee).toBe("Boulangerie du Coin");
  });
});

describe("buildSageCsv", () => {
  const row: SageCsvRow = {
    date: "2026-06-15",
    direction: "Expense",
    vendorOrPayee: 'Smith, "Bob" & Co',
    description: "Perceuse; Ruban",
    subtotal: 1820,
    gstHst: 91,
    qst: 181.55,
    total: 2092.55,
    documentType: "invoice",
    currency: "CAD",
    client: "Acme Corp",
    engagement: "Year-End 2025",
    link: "https://vylan.app/x",
  };

  it("starts with a UTF-8 BOM so accents survive in Excel/Sage", () => {
    const csv = buildSageCsv([row]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("has the header row with all columns and CRLF line endings", () => {
    const csv = buildSageCsv([row]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toContain('"Date"');
    expect(lines[0]).toContain('"GST/HST"');
    expect(lines[0]).toContain('"QST"');
    // header + 1 row + trailing empty (from the final CRLF)
    expect(lines.length).toBe(3);
    expect(lines[2]).toBe("");
  });

  it("quotes fields and escapes internal quotes; formats money to 2 decimals; no thousands separators", () => {
    const csv = buildSageCsv([row]);
    const dataLine = csv.replace(/^﻿/, "").split("\r\n")[1];
    // internal quotes doubled
    expect(dataLine).toContain('"Smith, ""Bob"" & Co"');
    // money: 2 decimals, no comma grouping
    expect(dataLine).toContain('"1820.00"');
    expect(dataLine).toContain('"91.00"');
    expect(dataLine).toContain('"181.55"');
    expect(dataLine).toContain('"2092.55"');
  });

  it("leaves an absent amount blank rather than 0", () => {
    const csv = buildSageCsv([{ ...row, qst: null }]);
    const dataLine = csv.replace(/^﻿/, "").split("\r\n")[1];
    const qstIdx = SAGE_CSV_COLUMNS.findIndex((c) => c.key === "qst");
    const cells = dataLine.split('","');
    expect(cells[qstIdx].replace(/"/g, "")).toBe("");
  });
});

describe("sageCsvFilename", () => {
  it("builds a readable, slugged filename with the date", () => {
    expect(sageCsvFilename("Acme Corp", "Year-End 2025", "2026-07-17")).toBe(
      "vylan-sage50-acme-corp-year-end-2025-2026-07-17.csv",
    );
  });

  it("strips accents from French names", () => {
    expect(
      sageCsvFilename("Trésor Inc.", "Fin d'année", "2026-07-17T10:00:00Z"),
    ).toBe("vylan-sage50-tresor-inc-fin-d-annee-2026-07-17.csv");
  });

  it("falls back to 'export' when a name has no usable characters", () => {
    expect(sageCsvFilename("", "", "2026-07-17")).toBe(
      "vylan-sage50-export-export-2026-07-17.csv",
    );
  });
});
