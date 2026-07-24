import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isSignwellConfigured,
  isSignwellTestMode,
  isSignwellEmbeddedEditingEnabled,
  signwellApiApplicationId,
  mapSignwellStatus,
  createSignatureDocument,
  sendDocument,
  getDocument,
  getCompletedPdf,
  SignwellError,
} from "./client";

describe("isSignwellTestMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to test mode when unset (fails safe)", () => {
    vi.stubEnv("SIGNWELL_TEST_MODE", "");
    expect(isSignwellTestMode()).toBe(true);
  });

  it("stays in test mode for 'true'", () => {
    vi.stubEnv("SIGNWELL_TEST_MODE", "true");
    expect(isSignwellTestMode()).toBe(true);
  });

  it("only goes live when exactly 'false' (case-insensitive)", () => {
    vi.stubEnv("SIGNWELL_TEST_MODE", "false");
    expect(isSignwellTestMode()).toBe(false);
    vi.stubEnv("SIGNWELL_TEST_MODE", "FALSE");
    expect(isSignwellTestMode()).toBe(false);
    vi.stubEnv("SIGNWELL_TEST_MODE", "  False  ");
    expect(isSignwellTestMode()).toBe(false);
  });

  it("fails safe to test mode for any other value", () => {
    vi.stubEnv("SIGNWELL_TEST_MODE", "live");
    expect(isSignwellTestMode()).toBe(true);
    vi.stubEnv("SIGNWELL_TEST_MODE", "0");
    expect(isSignwellTestMode()).toBe(true);
  });
});

describe("isSignwellConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is false when the key is unset or blank", () => {
    vi.stubEnv("SIGNWELL_API_KEY", "");
    expect(isSignwellConfigured()).toBe(false);
  });

  it("is true when the key is set", () => {
    vi.stubEnv("SIGNWELL_API_KEY", "sk_test_abc");
    expect(isSignwellConfigured()).toBe(true);
  });
});

describe("mapSignwellStatus", () => {
  it("normalizes SignWell's mixed-case lifecycle to our set", () => {
    expect(mapSignwellStatus("Created")).toBe("sent");
    expect(mapSignwellStatus("Sent")).toBe("sent");
    expect(mapSignwellStatus("Viewed")).toBe("viewed");
    expect(mapSignwellStatus("Completed")).toBe("completed");
    expect(mapSignwellStatus("Manually completed")).toBe("completed");
    expect(mapSignwellStatus("Declined")).toBe("declined");
    expect(mapSignwellStatus("Canceled")).toBe("canceled");
    expect(mapSignwellStatus("Expired")).toBe("expired");
    expect(mapSignwellStatus("Bounced")).toBe("error");
    expect(mapSignwellStatus("Draft")).toBe("pending");
  });

  it("falls back to 'sent' for unknown/empty values (never crashes the insert)", () => {
    expect(mapSignwellStatus("something-new")).toBe("sent");
    expect(mapSignwellStatus("")).toBe("sent");
    expect(mapSignwellStatus(null)).toBe("sent");
    expect(mapSignwellStatus(undefined)).toBe("sent");
  });
});

describe("createSignatureDocument", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNWELL_API_KEY", "test-key");
    vi.stubEnv("SIGNWELL_TEST_MODE", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const valid = {
    name: "Engagement letter",
    fileBase64: "QkFTRTY0",
    fileName: "letter.pdf",
    signerEmail: "client@example.com",
    signerName: "Jane Client",
    metadata: { request_item_id: "item_1", engagement_id: "eng_1" },
  };

  it("posts an embedded, no-email, test-mode request and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "doc_123",
        status: "Created",
        test_mode: true,
        recipients: [
          { id: "client", embedded_signing_url: "https://embed.example/s" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createSignatureDocument(valid);

    expect(res).toEqual({
      documentId: "doc_123",
      status: "sent", // "Created" -> sent
      testMode: true,
      embeddedSigningUrl: "https://embed.example/s",
      embeddedEditUrl: null, // default mode: no editor url
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.signwell.com/api/v1/documents");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Api-Key"]).toBe("test-key");

    const body = JSON.parse(init.body as string);
    expect(body.test_mode).toBe(true);
    expect(body.embedded_signing).toBe(true);
    expect(body.reminders).toBe(false);
    expect(body.draft).toBe(false);
    // Auto signature page so the signer always has a field (avoids the SignWell
    // "with_no_fields" rejection).
    expect(body.with_signature_page).toBe(true);
    expect(body.files[0]).toEqual({
      name: "letter.pdf",
      file_base64: "QkFTRTY0",
    });
    expect(body.recipients[0].email).toBe("client@example.com");
    expect(body.recipients[0].send_email).toBe(false);
    expect(body.metadata).toEqual({
      request_item_id: "item_1",
      engagement_id: "eng_1",
    });
  });

  it("throws no_signer_email before any network call when email is blank", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createSignatureDocument({ ...valid, signerEmail: "  " }),
    ).rejects.toMatchObject({ code: "no_signer_email" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws create_failed (with status) on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "Unprocessable",
      }),
    );
    await expect(createSignatureDocument(valid)).rejects.toMatchObject({
      code: "create_failed",
      status: 422,
    });
  });

  it("throws not_configured when the API key is missing", async () => {
    vi.stubEnv("SIGNWELL_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    await expect(createSignatureDocument(valid)).rejects.toBeInstanceOf(
      SignwellError,
    );
    await expect(createSignatureDocument(valid)).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

describe("signwellApiApplicationId / isSignwellEmbeddedEditingEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the trimmed application id, or null when unset/blank", () => {
    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "");
    expect(signwellApiApplicationId()).toBeNull();
    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "  app_123  ");
    expect(signwellApiApplicationId()).toBe("app_123");
  });

  it("is enabled only when BOTH the API key and application id are set", () => {
    vi.stubEnv("SIGNWELL_API_KEY", "");
    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "app_123");
    expect(isSignwellEmbeddedEditingEnabled()).toBe(false); // no key

    vi.stubEnv("SIGNWELL_API_KEY", "test-key");
    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "");
    expect(isSignwellEmbeddedEditingEnabled()).toBe(false); // no app id

    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "app_123");
    expect(isSignwellEmbeddedEditingEnabled()).toBe(true);
  });
});

describe("createSignatureDocument (embedded editing)", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNWELL_API_KEY", "test-key");
    vi.stubEnv("SIGNWELL_TEST_MODE", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const valid = {
    name: "Engagement letter",
    fileBase64: "QkFTRTY0",
    fileName: "letter.pdf",
    signerEmail: "client@example.com",
    signerName: "Jane Client",
  };

  it("creates an editable DRAFT with the API Application and returns the editor url", async () => {
    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "app_123");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "doc_draft",
        status: "Draft",
        test_mode: true,
        embedded_edit_url: "https://edit.example/e",
        recipients: [{ id: "client" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createSignatureDocument({ ...valid, embeddedEdit: true });
    expect(res.documentId).toBe("doc_draft");
    expect(res.embeddedEditUrl).toBe("https://edit.example/e");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Draft + no auto page (accountant places the field) + tied to the app.
    expect(body.draft).toBe(true);
    expect(body.with_signature_page).toBe(false);
    expect(body.api_application_id).toBe("app_123");
  });

  it("falls back to the auto signature page when NO application id is set", async () => {
    vi.stubEnv("SIGNWELL_API_APPLICATION_ID", "");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "doc_x", status: "Created", recipients: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createSignatureDocument({ ...valid, embeddedEdit: true });
    expect(res.embeddedEditUrl).toBeNull();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.draft).toBe(false);
    expect(body.with_signature_page).toBe(true);
    expect(body.api_application_id).toBeUndefined();
  });
});

describe("sendDocument", () => {
  beforeEach(() => vi.stubEnv("SIGNWELL_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POSTs to /send and returns the mapped status (Draft -> sent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "doc_1", status: "Sent" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await sendDocument("doc_1");
    expect(status).toBe("sent");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.signwell.com/api/v1/documents/doc_1/send");
    expect(init.method).toBe("POST");
  });

  it("treats an unreadable body as a successful send", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("no body");
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendDocument("doc_1")).toBe("sent");
  });

  it("throws create_failed on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => "not a draft",
      }),
    );
    await expect(sendDocument("doc_1")).rejects.toMatchObject({
      code: "create_failed",
      status: 409,
    });
  });
});

describe("getDocument", () => {
  beforeEach(() => vi.stubEnv("SIGNWELL_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches the document and returns normalized status + fresh embedded url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "doc_123",
        status: "Viewed",
        recipients: [
          { id: "client", embedded_signing_url: "https://embed.example/fresh" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getDocument("doc_123");
    expect(res).toEqual({
      status: "viewed",
      embeddedSigningUrl: "https://embed.example/fresh",
      embeddedEditUrl: null,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.signwell.com/api/v1/documents/doc_123");
    expect(init.method).toBe("GET");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
  });

  it("surfaces a fresh editor url for a draft (used to resume placement)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "doc_draft",
          status: "Draft",
          embedded_edit_url: "https://edit.example/fresh",
          recipients: [{ id: "client" }],
        }),
      }),
    );
    const res = await getDocument("doc_draft");
    expect(res.status).toBe("pending");
    expect(res.embeddedEditUrl).toBe("https://edit.example/fresh");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not found",
      }),
    );
    await expect(getDocument("missing")).rejects.toMatchObject({
      code: "request_failed",
      status: 404,
    });
  });
});

describe("getCompletedPdf", () => {
  beforeEach(() => vi.stubEnv("SIGNWELL_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("downloads the signed PDF (with audit page) as bytes", async () => {
    const bytes = new TextEncoder().encode("%PDF-signed");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const buf = await getCompletedPdf("doc_123");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("%PDF-signed");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://www.signwell.com/api/v1/documents/doc_123/completed_pdf?audit_page=true",
    );
    expect(init.method).toBe("GET");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      }),
    );
    await expect(getCompletedPdf("doc_123")).rejects.toMatchObject({
      code: "request_failed",
      status: 500,
    });
  });
});
