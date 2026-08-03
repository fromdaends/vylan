import { describe, it, expect, vi, beforeEach } from "vitest";

const logUserActivityAs = vi.fn();
const resolveArchiveFile = vi.fn();
const getCurrentFirm = vi.fn();
const getUser = vi.fn();
const afterCalls: Promise<unknown>[] = [];

vi.mock("@/lib/db/activity", () => ({
  logUserActivityAs: (...a: unknown[]) => logUserActivityAs(...a),
}));
vi.mock("@/lib/archive/download", () => ({
  resolveArchiveFile: (...a: unknown[]) => resolveArchiveFile(...a),
}));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/db/users", () => ({ getCurrentUser: async () => ({ locale: "en" }) }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ auth: { getUser: () => getUser() } }),
  getServiceRoleSupabase: () => ({}),
}));
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

const RESOLVED = {
  storagePath: "firms/f/signed.pdf",
  filename: "Engagement letter.pdf",
  mimeType: "application/pdf",
  engagementId: "eng-1",
};

function get(url: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(new Request(url, { headers })), {
    params: Promise.resolve({
      id: "client-9",
      category: "signed",
      fileId: "file-1",
    }),
  }) as unknown as Promise<Response>;
}

const flush = () => Promise.all(afterCalls);
const url = (qs = "") =>
  `http://localhost/api/clients/client-9/archive/file/signed/file-1${qs}`;

describe("GET /api/clients/[id]/archive/file/… — the download audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    resolveArchiveFile.mockResolvedValue(RESOLVED);
    getCurrentFirm.mockResolvedValue({ id: "firm-1" });
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bytes", { status: 200 })),
    );
  });

  it("writes exactly one audit row, scoped to the client and engagement", async () => {
    const res = await get(url("?download=1"));
    await flush();

    expect(res.status).toBe(200);
    expect(logUserActivityAs).toHaveBeenCalledTimes(1);
    expect(logUserActivityAs).toHaveBeenCalledWith(
      "firm-1",
      "eng-1",
      "user-1",
      "file_downloaded",
      {
        source: "signed",
        file_id: "file-1",
        name: "Engagement letter.pdf",
        route: "archive",
        client_id: "client-9",
      },
    );
  });

  it("does not write a second row for the rest of the same download", async () => {
    await get(url("?download=1"));
    await get(url("?download=1"), { range: "bytes=4096-" });
    await flush();

    expect(logUserActivityAs).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a signed-out request", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await get(url("?download=1"));
    await flush();

    expect(res.status).toBe(401);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("writes nothing for a file outside the caller's firm", async () => {
    resolveArchiveFile.mockResolvedValue(null);

    const res = await get(url("?download=1"));
    await flush();

    expect(res.status).toBe(404);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("writes nothing when the file is only opened inline", async () => {
    const res = await get(url());
    await flush();

    expect(res.status).toBe(200);
    expect(logUserActivityAs).not.toHaveBeenCalled();
  });
});
