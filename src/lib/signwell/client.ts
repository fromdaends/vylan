// SignWell API client (embedded e-signatures).
//
// Thin wrapper over the SignWell v1 REST API. The API key is read from the
// environment on every call (never hardcoded, never logged). Test vs live is a
// runtime switch (isSignwellTestMode) driven by SIGNWELL_TEST_MODE, so flipping
// to live is a single env-var change with no code change.
//
// Endpoints used (verified against https://developers.signwell.com):
//   POST /api/v1/documents            create a signature request (this file)
//   GET  /api/v1/documents/{id}       refresh embedded signing url (Phase 3)
//   GET  /api/v1/documents/{id}/completed_pdf   signed PDF + audit (Phase 4)
//
// Auth header: `X-Api-Key: <key>`.

const SIGNWELL_BASE_URL = "https://www.signwell.com/api/v1";

export class SignwellError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "no_signer_email"
      | "create_failed"
      | "request_failed",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SignwellError";
  }
}

export function isSignwellConfigured(): boolean {
  return Boolean(process.env.SIGNWELL_API_KEY?.trim());
}

// Signing is in TEST mode (watermarked, free, NOT legally binding) by default
// and only switches to live when SIGNWELL_TEST_MODE is exactly "false"
// (case-insensitive). Fails safe to test: an unset/blank/typo'd value stays in
// test mode, so a real signature is never created by accident.
export function isSignwellTestMode(): boolean {
  return (process.env.SIGNWELL_TEST_MODE ?? "").trim().toLowerCase() !== "false";
}

// Normalize SignWell's mixed-case lifecycle status into our lowercase set (the
// signature_requests.status CHECK constraint). Anything unrecognized but
// pre-completion is treated as "sent" (out for signature); hard failures map to
// "error". Keep this total — an unmapped value must never reach the DB.
export type SignatureStatus =
  | "pending"
  | "sent"
  | "viewed"
  | "completed"
  | "declined"
  | "canceled"
  | "expired"
  | "error";

export function mapSignwellStatus(raw: string | null | undefined): SignatureStatus {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "draft":
      return "pending";
    case "created":
    case "sending":
    case "sent":
    case "pending":
    case "in progress":
    case "in_progress":
      return "sent";
    case "viewed":
      return "viewed";
    case "completed":
    case "manually completed":
      return "completed";
    case "declined":
      return "declined";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "expired":
      return "expired";
    case "bounced":
    case "blocked":
    case "error":
      return "error";
    default:
      return "sent";
  }
}

type SignwellRecipientResponse = {
  id?: string;
  email?: string;
  name?: string;
  embedded_signing_url?: string | null;
};

type SignwellDocumentResponse = {
  id: string;
  status: string;
  test_mode?: boolean;
  recipients?: SignwellRecipientResponse[];
};

async function signwellFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const key = process.env.SIGNWELL_API_KEY?.trim();
  if (!key) {
    throw new SignwellError("not_configured", "SIGNWELL_API_KEY is not set");
  }
  let res: Response;
  try {
    res = await fetch(`${SIGNWELL_BASE_URL}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (e) {
    throw new SignwellError(
      "request_failed",
      `SignWell request failed: ${(e as Error).message}`,
    );
  }
  return res;
}

// Cap any upstream error body we keep so a large/HTML error page can't bloat the
// stored error_detail. The API key never appears in a response body.
function truncateDetail(s: string, max = 500): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

export type CreateSignatureDocInput = {
  // Display name of the document in SignWell.
  name: string;
  // The PDF to be signed, base64-encoded (RFC 4648), plus its filename.
  fileBase64: string;
  fileName: string;
  // The single signer (the client).
  signerEmail: string;
  signerName?: string | null;
  // Correlation keys echoed back on webhook events (Phase 4). Keys < 40 chars,
  // values < 500 chars per SignWell limits.
  metadata?: Record<string, string>;
};

export type CreateSignatureDocResult = {
  documentId: string;
  status: SignatureStatus;
  testMode: boolean;
  // Present in the create response; may be refreshed later via GET /documents.
  embeddedSigningUrl: string | null;
};

// Create a SignWell document for EMBEDDED signing by a single signer.
//
// - test_mode is set from the runtime switch (watermarked while building).
// - embedded_signing: true renders inside our portal (no redirect to signwell).
// - The recipient's send_email is false and reminders are off, so SignWell does
//   NOT email the client a competing link — the client signs inside Vylan.
// - No signature `fields` are placed here; field placement is decided in Phase 3
//   (embedded signing UX). The document is still created and returns an id.
export async function createSignatureDocument(
  input: CreateSignatureDocInput,
): Promise<CreateSignatureDocResult> {
  if (!input.signerEmail?.trim()) {
    throw new SignwellError("no_signer_email", "Signer email is required");
  }

  const testMode = isSignwellTestMode();
  const body = {
    test_mode: testMode,
    embedded_signing: true,
    // No SignWell-side emails or reminders: signing happens embedded in Vylan.
    reminders: false,
    draft: false,
    name: input.name,
    files: [{ name: input.fileName, file_base64: input.fileBase64 }],
    recipients: [
      {
        id: "client",
        email: input.signerEmail.trim(),
        ...(input.signerName?.trim() ? { name: input.signerName.trim() } : {}),
        send_email: false,
      },
    ],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  const res = await signwellFetch("/documents", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SignwellError(
      "create_failed",
      `SignWell create failed (${res.status}): ${truncateDetail(detail)}`,
      res.status,
    );
  }

  const json = (await res.json()) as SignwellDocumentResponse;
  const recipient =
    json.recipients?.find((r) => r.id === "client") ?? json.recipients?.[0];

  return {
    documentId: json.id,
    status: mapSignwellStatus(json.status),
    testMode: json.test_mode ?? testMode,
    embeddedSigningUrl: recipient?.embedded_signing_url ?? null,
  };
}
