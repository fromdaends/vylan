import { describe, it, expect, vi, beforeEach } from "vitest";

const logUserActivityAs = vi.fn();
const afterCalls: Promise<unknown>[] = [];

vi.mock("@/lib/db/activity", () => ({
  logUserActivityAs: (...a: unknown[]) => logUserActivityAs(...a),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Run the deferred work immediately, but keep the promise so a test can
  // await it — `after` normally runs once the response has been sent.
  after: (fn: () => Promise<unknown>) => {
    afterCalls.push(Promise.resolve(fn()));
  },
}));

import { countsAsDownload, isRangeStart, recordDocumentDownload } from "./download-audit";

const flush = () => Promise.all(afterCalls);

describe("isRangeStart", () => {
  it("treats an absent Range header as the start of a transfer", () => {
    expect(isRangeStart(null)).toBe(true);
  });

  it("treats the first chunk as the start", () => {
    expect(isRangeStart("bytes=0-")).toBe(true);
    expect(isRangeStart("bytes=0-1023")).toBe(true);
    expect(isRangeStart(" BYTES = 0 - 1023 ")).toBe(true);
  });

  it("treats a continuation or a probe as NOT the start", () => {
    // A resumed download, the second chunk of a chunked one, and a suffix
    // range: all belong to a transfer that has already been counted.
    expect(isRangeStart("bytes=1024-")).toBe(false);
    expect(isRangeStart("bytes=500-999")).toBe(false);
    expect(isRangeStart("bytes=-500")).toBe(false);
    expect(isRangeStart("bytes=0-99, 200-299")).toBe(true); // first byte IS 0
    expect(isRangeStart("items=0-10")).toBe(false); // not a byte range at all
  });
});

describe("countsAsDownload", () => {
  it("counts a plain ?download=1 request", () => {
    expect(countsAsDownload({ wantsDownload: true, range: null })).toBe(true);
    expect(countsAsDownload({ wantsDownload: true, range: "bytes=0-" })).toBe(true);
  });

  it("never counts an inline preview, however it is fetched", () => {
    // The in-app viewer streams the same bytes through the same route. A read
    // is not a download, and pdf.js issues one request per page range.
    expect(countsAsDownload({ wantsDownload: false, range: null })).toBe(false);
    expect(countsAsDownload({ wantsDownload: false, range: "bytes=0-" })).toBe(false);
    expect(countsAsDownload({ wantsDownload: false, range: "bytes=65536-" })).toBe(false);
  });

  it("counts a resumed download once, not once per chunk", () => {
    expect(countsAsDownload({ wantsDownload: true, range: "bytes=0-" })).toBe(true);
    expect(countsAsDownload({ wantsDownload: true, range: "bytes=8192-" })).toBe(false);
    expect(countsAsDownload({ wantsDownload: true, range: "bytes=16384-" })).toBe(false);
  });
});

describe("recordDocumentDownload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCalls.length = 0;
  });

  it("writes one file_downloaded row attributed to the acting user", async () => {
    recordDocumentDownload({
      firmId: "firm-1",
      engagementId: "eng-1",
      clientId: null,
      source: "checklist",
      documentId: "doc-1",
      fileName: "T4-2025.pdf",
      route: "files",
      actorId: "user-1",
    });
    await flush();

    expect(logUserActivityAs).toHaveBeenCalledTimes(1);
    expect(logUserActivityAs).toHaveBeenCalledWith(
      "firm-1",
      "eng-1",
      "user-1",
      "file_downloaded",
      { source: "checklist", file_id: "doc-1", name: "T4-2025.pdf", route: "files" },
    );
  });

  it("carries client_id for a document with no engagement, so the row names its client", async () => {
    // An imported document hangs off a client, not an engagement, and
    // enrichActivityEntries resolves the client from metadata.client_id.
    recordDocumentDownload({
      firmId: "firm-1",
      engagementId: null,
      clientId: "client-9",
      source: "imported",
      documentId: "doc-2",
      fileName: "2023 books.pdf",
      route: "files",
      actorId: "user-1",
    });
    await flush();

    expect(logUserActivityAs).toHaveBeenCalledWith(
      "firm-1",
      null,
      "user-1",
      "file_downloaded",
      {
        source: "imported",
        file_id: "doc-2",
        name: "2023 books.pdf",
        route: "files",
        client_id: "client-9",
      },
    );
  });

  it("hands the write to after() and returns nothing to await", () => {
    // The caller is a byte route: it must be able to fire this and return the
    // response immediately, never awaiting an audit insert before the file.
    const returned = recordDocumentDownload({
      firmId: "firm-1",
      engagementId: "eng-1",
      source: "checklist",
      documentId: "doc-1",
      fileName: "a.pdf",
      route: "files",
      actorId: "user-1",
    });
    expect(returned).toBeUndefined();
    expect(afterCalls).toHaveLength(1);
  });

  it("swallows a failed write — a lost log line must not fail a download", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logUserActivityAs.mockRejectedValueOnce(new Error("db down"));
    recordDocumentDownload({
      firmId: "firm-1",
      engagementId: "eng-1",
      source: "checklist",
      documentId: "doc-1",
      fileName: "a.pdf",
      route: "files",
      actorId: "user-1",
    });
    await expect(flush()).resolves.toBeDefined();
  });
});
