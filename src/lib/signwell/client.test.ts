import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isSignwellConfigured,
  isSignwellTestMode,
  mapSignwellStatus,
  createSignatureDocument,
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
