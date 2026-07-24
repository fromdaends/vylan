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

// Reads the API Application id used for embedded requesting (the accountant
// placing signature fields in an embedded editor). Present only when the founder
// has created an API Application in the SignWell dashboard and set the env var.
// When absent we fall back to the auto-appended signature page — so this returns
// the id (drag-and-drop placement on) or null (fall back to the old behavior).
export function signwellApiApplicationId(): string | null {
  return process.env.SIGNWELL_API_APPLICATION_ID?.trim() || null;
}

// Is the "place the signature anywhere" flow available? True only when SignWell
// is configured AND an API Application id is set (embedded requesting needs it).
export function isSignwellEmbeddedEditingEnabled(): boolean {
  return isSignwellConfigured() && signwellApiApplicationId() !== null;
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
  // Present when the document was created for embedded requesting (draft +
  // api_application_id): the sender-side URL that loads SignWell's field-placement
  // editor in an iframe. Expires after it's first opened, so we re-read it (via
  // getDocument) when the accountant resumes rather than storing it.
  embedded_edit_url?: string | null;
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
  // When true, create the document as an editable DRAFT tied to the API
  // Application so the accountant places the signature field(s) themselves in
  // SignWell's embedded editor, and DON'T auto-append a signature page. The
  // returned embeddedEditUrl loads that editor. Requires an API Application id
  // (signwellApiApplicationId); when that's missing this silently falls back to
  // the auto-appended signature page so nothing breaks before setup. When false
  // or omitted: the original behavior (auto signature page, sent immediately).
  embeddedEdit?: boolean;
};

export type CreateSignatureDocResult = {
  documentId: string;
  status: SignatureStatus;
  testMode: boolean;
  // Present in the create response; may be refreshed later via GET /documents.
  embeddedSigningUrl: string | null;
  // The sender-side field-placement editor URL — non-null only for a document
  // created with embeddedEdit (draft + api_application_id). Null otherwise.
  embeddedEditUrl: string | null;
};

// Create a SignWell document for EMBEDDED signing by a single signer.
//
// - test_mode is set from the runtime switch (watermarked while building).
// - embedded_signing: true renders inside our portal (no redirect to signwell).
// - The recipient's send_email is false and reminders are off, so SignWell does
//   NOT email the client a competing link — the client signs inside Vylan.
//
// Field placement has two modes:
//
// - DEFAULT (embeddedEdit falsy, or no API Application configured):
//   with_signature_page: true makes SignWell auto-append a clean signature page
//   with a signature field for the signer, and the document is sent immediately
//   (draft: false). SignWell REJECTS a sendable document whose signer has no
//   field ("with_no_fields"), so this guarantees a field without us having to
//   know the PDF's layout — but the signature always lands on that appended page.
//
// - EMBEDDED EDITING (embeddedEdit: true AND an API Application id is set):
//   the document is created as a DRAFT (draft: true) with no auto signature page,
//   and SignWell returns an embedded_edit_url. The accountant opens that editor
//   and drops the signature field wherever they want, on any page. The document
//   is sent later via sendDocument (after placement) — so the client is only
//   notified once the fields are positioned.
export async function createSignatureDocument(
  input: CreateSignatureDocInput,
): Promise<CreateSignatureDocResult> {
  if (!input.signerEmail?.trim()) {
    throw new SignwellError("no_signer_email", "Signer email is required");
  }

  const testMode = isSignwellTestMode();
  // Embedded editing only engages when explicitly requested AND an API
  // Application is configured; otherwise fall back to the auto signature page so
  // signing keeps working before the founder sets that up.
  const apiApplicationId = signwellApiApplicationId();
  const useEditor = input.embeddedEdit === true && apiApplicationId !== null;

  const body = {
    test_mode: testMode,
    embedded_signing: true,
    // No SignWell-side emails or reminders: signing happens embedded in Vylan.
    reminders: false,
    // Editor mode holds the document as a draft until the accountant has placed
    // the fields; sendDocument releases it. Default mode sends right away.
    draft: useEditor,
    // Auto-append a signature page ONLY in default mode. In editor mode the
    // accountant places the field, so an appended page would be a stray duplicate.
    with_signature_page: !useEditor,
    // Tie the draft to the API Application so the embedded editor is authorized.
    ...(useEditor ? { api_application_id: apiApplicationId } : {}),
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
    embeddedEditUrl: json.embedded_edit_url ?? null,
  };
}

// Send a document that was created as a draft for embedded editing. Once the
// accountant has placed the signature field(s), this releases the draft so the
// client can sign. The recipient keeps send_email: false, so SignWell sends no
// competing email — Vylan sends its own branded notification. Returns the
// document status after sending. Idempotent from the caller's side: SignWell
// rejects sending a non-draft, so callers check the current status first.
export async function sendDocument(documentId: string): Promise<SignatureStatus> {
  const res = await signwellFetch(
    `/documents/${encodeURIComponent(documentId)}/send`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SignwellError(
      "create_failed",
      `SignWell send failed (${res.status}): ${truncateDetail(detail)}`,
      res.status,
    );
  }
  // The send response echoes the document; a created/sent document is at least
  // "sent". Parse defensively — treat an unreadable body as a successful send.
  const json = (await res.json().catch(() => null)) as
    | SignwellDocumentResponse
    | null;
  const mapped = json ? mapSignwellStatus(json.status) : "sent";
  return mapped === "pending" ? "sent" : mapped;
}

export type SignwellDocumentState = {
  status: SignatureStatus;
  // Fresh embedded signing url for the signer; embedded urls can expire, so we
  // fetch this when the client opens the portal rather than storing it.
  embeddedSigningUrl: string | null;
  // Fresh sender-side field-placement editor url — non-null only while the
  // document is a draft created for embedded editing. Used to RESUME placement
  // when the accountant closed the editor without sending (the create-time url
  // expires after first open, so we re-read a fresh one here).
  embeddedEditUrl: string | null;
};

// Fetch the current state of a document — its status, a fresh embedded signing
// url for the signer, and a fresh field-placement editor url for the sender.
// Used when the client opens the portal to sign, and when the accountant resumes
// placing fields on a draft.
export async function getDocument(
  documentId: string,
): Promise<SignwellDocumentState> {
  const res = await signwellFetch(
    `/documents/${encodeURIComponent(documentId)}`,
    { method: "GET" },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SignwellError(
      "request_failed",
      `SignWell get document failed (${res.status}): ${truncateDetail(detail)}`,
      res.status,
    );
  }
  const json = (await res.json()) as SignwellDocumentResponse;
  const recipient =
    json.recipients?.find((r) => r.id === "client") ?? json.recipients?.[0];
  return {
    status: mapSignwellStatus(json.status),
    embeddedSigningUrl: recipient?.embedded_signing_url ?? null,
    embeddedEditUrl: json.embedded_edit_url ?? null,
  };
}

// Download the completed, signed PDF including SignWell's audit page (the
// tamper-evident trail of who signed, when, and from where). Returns the raw PDF
// bytes. This is a binary download, so it doesn't go through the JSON helper.
export async function getCompletedPdf(documentId: string): Promise<Buffer> {
  const key = process.env.SIGNWELL_API_KEY?.trim();
  if (!key) {
    throw new SignwellError("not_configured", "SIGNWELL_API_KEY is not set");
  }
  const url =
    `${SIGNWELL_BASE_URL}/documents/${encodeURIComponent(documentId)}` +
    `/completed_pdf?audit_page=true`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "X-Api-Key": key, Accept: "application/pdf" },
      cache: "no-store",
    });
  } catch (e) {
    throw new SignwellError(
      "request_failed",
      `SignWell completed_pdf failed: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SignwellError(
      "request_failed",
      `SignWell completed_pdf failed (${res.status}): ${truncateDetail(detail)}`,
      res.status,
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
