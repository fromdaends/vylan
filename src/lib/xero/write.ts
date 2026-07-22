// Xero Phase 4 (posting) — the authenticated WRITE calls: create a transaction,
// attach the source document, and undo (delete/void). Mirrors the read helpers in
// client.ts (Bearer + Xero-tenant-id, XeroError on non-2xx) but POSTs.
//
// IDEMPOTENCY. Xero honours an `Idempotency-Key` header so a retried create
// returns the ORIGINAL instead of duplicating — but the key is remembered for
// only ~6 MINUTES (and a cached error replays too). So this is a safety net for
// in-flight retries, NOT a durable dedupe; the orchestration still records the
// posted id and never blind-retries beyond that window.

import { XeroError, XERO_API_BASE_URL } from "./client";
import type { XeroReadContext } from "./connection";

// Creates/undo are quick; attachments upload a file, so they get more headroom.
const XERO_WRITE_TIMEOUT_MS = 20_000;
const XERO_ATTACHMENT_TIMEOUT_MS = 60_000;
// Xero rejects attachments larger than 10 MB.
const XERO_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Which Xero endpoint an entity lives under (for creates, undo, and attachments).
export type XeroTxnEndpoint = "Invoices" | "BankTransactions";

// The bits of a created transaction the orchestration records + tax-checks.
export type XeroCreatedTxn = {
  id: string; // InvoiceID or BankTransactionID (Xero has no per-type id collision)
  total: number | null;
  totalTax: number | null;
  status: string | null;
};

// POST a JSON body to a tenant-scoped Accounting endpoint. Optional
// Idempotency-Key makes an in-flight retry safe (returns the original create).
async function xeroPostJson(
  ctx: XeroReadContext,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.accessToken}`,
    "Xero-tenant-id": ctx.tenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${XERO_API_BASE_URL}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(XERO_WRITE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "request_failed",
      `Xero ${path} write failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

function readCreated(
  row: Record<string, unknown> | undefined,
  idKey: string,
): XeroCreatedTxn {
  return {
    id: String(row?.[idKey] ?? ""),
    total: typeof row?.Total === "number" ? (row.Total as number) : null,
    totalTax: typeof row?.TotalTax === "number" ? (row.TotalTax as number) : null,
    status: typeof row?.Status === "string" ? (row.Status as string) : null,
  };
}

// Create a Xero Invoice (ACCPAY bill / ACCREC invoice). Returns the created id +
// Xero-computed Total/TotalTax (feeds the tax-discrepancy check). Throws XeroError.
export async function xeroCreateInvoice(
  ctx: XeroReadContext,
  invoice: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<XeroCreatedTxn> {
  const json = await xeroPostJson(ctx, "Invoices", { Invoices: [invoice] }, idempotencyKey);
  const created = (json.Invoices as Record<string, unknown>[] | undefined)?.[0];
  const out = readCreated(created, "InvoiceID");
  if (!out.id) {
    throw new XeroError("request_failed", "Xero Invoices create returned no InvoiceID");
  }
  return out;
}

// Create a Xero BankTransaction (SPEND paid-expense / RECEIVE paid-income).
export async function xeroCreateBankTransaction(
  ctx: XeroReadContext,
  txn: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<XeroCreatedTxn> {
  const json = await xeroPostJson(
    ctx,
    "BankTransactions",
    { BankTransactions: [txn] },
    idempotencyKey,
  );
  const created = (json.BankTransactions as Record<string, unknown>[] | undefined)?.[0];
  const out = readCreated(created, "BankTransactionID");
  if (!out.id) {
    throw new XeroError(
      "request_failed",
      "Xero BankTransactions create returned no BankTransactionID",
    );
  }
  return out;
}

// Undo an Invoice: DRAFT/SUBMITTED → DELETED; AUTHORISED → VOIDED (Xero rejects
// VOID on a draft and DELETE on an authorised one, so the caller picks by status).
export async function xeroSetInvoiceStatus(
  ctx: XeroReadContext,
  invoiceId: string,
  status: "DELETED" | "VOIDED",
): Promise<void> {
  await xeroPostJson(ctx, `Invoices/${encodeURIComponent(invoiceId)}`, {
    Invoices: [{ InvoiceID: invoiceId, Status: status }],
  });
}

// Undo a BankTransaction: only DELETED is valid (there is no VOID for these).
export async function xeroDeleteBankTransaction(
  ctx: XeroReadContext,
  bankTransactionId: string,
): Promise<void> {
  await xeroPostJson(ctx, `BankTransactions/${encodeURIComponent(bankTransactionId)}`, {
    BankTransactions: [{ BankTransactionID: bankTransactionId, Status: "DELETED" }],
  });
}

// Attach the source document to a posted transaction (audit evidence, Dext/Hubdoc
// parity). endpoint is the entity's endpoint; guid is its InvoiceID/BankTransactionID.
// Xero caps attachments at 10 MB. Throws XeroError on failure (the caller treats a
// failed attach as best-effort — the post itself still stands).
export async function xeroUploadAttachment(
  ctx: XeroReadContext,
  endpoint: XeroTxnEndpoint,
  guid: string,
  file: { bytes: Buffer; fileName: string; mime: string },
): Promise<void> {
  if (file.bytes.length > XERO_MAX_ATTACHMENT_BYTES) {
    throw new XeroError(
      "request_failed",
      `Attachment ${file.fileName} exceeds Xero's 10 MB limit`,
    );
  }
  const safeName = encodeURIComponent(file.fileName.replace(/[/\\]/g, "_"));
  const res = await fetch(
    `${XERO_API_BASE_URL}/${endpoint}/${encodeURIComponent(guid)}/Attachments/${safeName}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        "Xero-tenant-id": ctx.tenantId,
        Accept: "application/json",
        "Content-Type": file.mime || "application/octet-stream",
      },
      // Wrap a fresh Uint8Array in a Blob (matches the QuickBooks upload path):
      // a valid BodyInit across runtimes, and the copy sidesteps the
      // ArrayBufferLike/ArrayBuffer typing mismatch on Buffer.
      body: new Blob([new Uint8Array(file.bytes)], {
        type: file.mime || "application/octet-stream",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(XERO_ATTACHMENT_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new XeroError(
      "request_failed",
      `Xero attachment upload failed (${res.status}): ${truncate(detail)}`,
      res.status,
    );
  }
}
