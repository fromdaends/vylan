import { describe, it, expect, vi, beforeEach } from "vitest";

// The audit write is the thing under test, so it is the ONLY thing mocked at
// the bottom of the stack — everything above it (the route's own download
// gate, the authorization result, the byte passthrough) runs for real.
const logUserActivityAs = vi.fn();
const resolveServableDocument = vi.fn();
const getCurrentFirm = vi.fn();
const afterCalls: Promise<unknown>[] = [];

vi.mock("@/lib/db/activity", () => ({
  logUserActivityAs: (...a: unknown[]) => logUserActivityAs(...a),
}));
vi.mock("@/lib/files/serve-document", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveServableDocument: (...a: unknown[]) => resolveServableDocument(...a),
}));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/storage", () => ({
  signedUrl: async () => "https://storage.test/signed",
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  after: (fn: () => Promise<unknown>) => {
    afterCalls.push(Promise.resolve(fn()));
  },
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const DOC = {
  source: "checklist" as const,
  id: "doc-1",
  storagePath: "firms/f/doc-1.pdf",
  mimeType: "application/pdf",
  fileName: "T4-2025.pdf",
  deletedAt: null,
  engagementId: "eng-1",
  clientId: null,
  actorId: "user-1",
};

function get(url: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(new Request(url, { headers })), {
    params: Promise.resolve({ id: "doc-1" }),
  }) as unknown as Promise<Response>;
}

/** Let the deferred audit write settle before asserting on it. */
const flush = () => Promise.all(afterCalls);

describe("GET /api/files/[id] — the download audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    resolveServableDocument.mockResolvedValue(DOC);
    getCurrentFirm.mockResolvedValue({ id: "firm-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bytes", { status: 200 })),
    );
  });

  it("writes exactly one audit row for a download", async () => {
    const res = await get("http://localhost/api/files/doc-1?download=1");
    await flush();

    expect(res.status).toBe(200);
    expect(logUserActivityAs).toHaveBeenCalledTimes(1);
    expect(logUserActivityAs).toHaveBeenCalledWith(
      "firm-1",
      "eng-1",
      "user-1",
      "file_downloaded",
      {
        source: "checklist",
        file_id: "doc-1",
        name: "T4-2025.pdf",
        route: "files",
      },
    );
  });

  it("does not write a second row for the rest of the same download", async () => {
    // A browser resuming or chunking a download re-asks for the same file.
    // One download must be one row, not one per chunk.
    await get("http://localhost/api/files/doc-1?download=1");
    await get("http://localhost/api/files/doc-1?download=1", {
      range: "bytes=1024-",
    });
    await get("http://localhost/api/files/doc-1?download=1", {
      range: "bytes=2048-4095",
    });
    await flush();

    expect(logUserActivityAs).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for an unauthorized request", async () => {
    // resolveServableDocument returns null for "does not exist" and "not
    // yours" alike — the route 404s and must never claim someone downloaded a
    // file they cannot read.
    resolveServableDocument.mockResolvedValue(null);

    const res = await get("http://localhost/api/files/doc-1?download=1");
    await flush();

    expect(res.status).toBe(404);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("writes nothing for a soft-deleted document", async () => {
    resolveServableDocument.mockResolvedValue({
      ...DOC,
      deletedAt: "2026-08-01T00:00:00Z",
    });

    const res = await get("http://localhost/api/files/doc-1?download=1");
    await flush();

    expect(res.status).toBe(404);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("writes nothing when the bytes never arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const res = await get("http://localhost/api/files/doc-1?download=1");
    await flush();

    expect(res.status).toBe(502);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("writes nothing for an inline preview, however many ranges it asks for", async () => {
    // This is the in-app viewer reading a document. Without this the audit log
    // would gain a "downloaded" row per page of every PDF anyone opens.
    await get("http://localhost/api/files/doc-1");
    await get("http://localhost/api/files/doc-1", { range: "bytes=0-65535" });
    await get("http://localhost/api/files/doc-1", { range: "bytes=65536-" });
    await flush();

    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("still serves the bytes when there is no firm to attribute it to", async () => {
    getCurrentFirm.mockResolvedValue(null);

    const res = await get("http://localhost/api/files/doc-1?download=1");
    await flush();

    expect(res.status).toBe(200);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("names the client on a download with no engagement behind it", async () => {
    resolveServableDocument.mockResolvedValue({
      ...DOC,
      source: "imported",
      engagementId: null,
      clientId: "client-9",
    });

    await get("http://localhost/api/files/doc-1?source=imported&download=1");
    await flush();

    expect(logUserActivityAs).toHaveBeenCalledWith(
      "firm-1",
      null,
      "user-1",
      "file_downloaded",
      expect.objectContaining({ source: "imported", client_id: "client-9" }),
    );
  });
});
