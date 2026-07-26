import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureRootFolder,
  escapeDriveQueryValue,
  googleDriveConnector,
} from "./google-drive";
import type { ConnectorContext } from "../types";

const ctx: ConnectorContext = {
  accessToken: "at_test",
  config: { rootFolderId: "root123" },
};

// URLSearchParams encodes spaces as "+" — normalize for readable assertions.
function qs(url: string | RequestInfo | URL): string {
  return decodeURIComponent(String(url)).replace(/\+/g, " ");
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("escapeDriveQueryValue", () => {
  it("escapes quotes and backslashes for Drive q strings", () => {
    expect(escapeDriveQueryValue("O'Brien Inc")).toBe("O\\'Brien Inc");
    expect(escapeDriveQueryValue("a\\b")).toBe("a\\\\b");
  });
});

describe("ensureFolderPath", () => {
  it("reuses existing folders and creates missing ones from the root", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET" && url.includes("/drive/v3/files?")) {
        // "Clients" exists under root; "Marie" does not.
        const q = qs(url);
        if (q.includes("name = 'Clients'")) {
          return jsonResponse({ files: [{ id: "fldClients" }] });
        }
        return jsonResponse({ files: [] });
      }
      if (method === "POST") {
        return jsonResponse({ id: "fldNew" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { folderId } = await googleDriveConnector.ensureFolderPath(ctx, [
      "Clients",
      "Marie",
    ]);
    expect(folderId).toBe("fldNew");

    // The lookup for "Clients" is scoped to the ROOT folder; the create for
    // "Marie" parents to the found "Clients" id.
    const lookupClients = calls.find((c) =>
      qs(c.url).includes("name = 'Clients'"),
    );
    expect(qs(lookupClients!.url)).toContain("'root123' in parents");
    const create = calls.find((c) => c.method === "POST");
    expect(create?.body).toMatchObject({
      name: "Marie",
      parents: ["fldClients"],
      mimeType: "application/vnd.google-apps.folder",
    });
    // Every call declares Shared Drive support.
    for (const c of calls) {
      expect(c.url).toContain("supportsAllDrives=true");
    }
  });

  it("throws when the connection has no root folder id", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      googleDriveConnector.ensureFolderPath(
        { accessToken: "t", config: {} },
        ["A"],
      ),
    ).rejects.toThrow("no root folder id");
  });
});

describe("fileExists", () => {
  it("matches any type by exact name in the folder", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const q = qs(input);
      expect(q).toContain("'fld1' in parents");
      expect(q).toContain("name = 'T4 - 2024.pdf'");
      // No mimeType clause: files AND folders both count as taken.
      expect(q).not.toContain("mimeType");
      return jsonResponse({ files: [{ id: "x" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await googleDriveConnector.fileExists(ctx, "fld1", "T4 - 2024.pdf"),
    ).toBe(true);
  });
});

describe("uploadFile", () => {
  it("initiates a resumable session then PUTs the bytes to it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("uploadType=resumable")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: "T4.pdf",
          parents: ["fld1"],
        });
        return new Response(null, {
          status: 200,
          headers: { location: "https://upload.session/abc" },
        });
      }
      if (url === "https://upload.session/abc") {
        expect(init?.method).toBe("PUT");
        return jsonResponse({
          id: "file9",
          webViewLink: "https://drive.google.com/file/d/file9",
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleDriveConnector.uploadFile(
      ctx,
      "fld1",
      "T4.pdf",
      new Uint8Array([1, 2, 3]),
      "application/pdf",
    );
    expect(result).toEqual({
      providerFileId: "file9",
      link: "https://drive.google.com/file/d/file9",
    });
  });

  it("surfaces an upload failure with the provider's message", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("uploadType=resumable")) {
        return new Response(null, {
          status: 200,
          headers: { location: "https://upload.session/abc" },
        });
      }
      return jsonResponse({ error: { message: "quota exceeded" } }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      googleDriveConnector.uploadFile(ctx, "fld1", "x.pdf", new Uint8Array(1), null),
    ).rejects.toThrow("quota exceeded");
  });
});

describe("ensureRootFolder", () => {
  it("reuses an existing app-created folder before creating", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const q = qs(input);
      expect(q).toContain("name = 'Vylan'");
      return jsonResponse({
        files: [{ id: "existing", webViewLink: "https://drive/x" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await ensureRootFolder("at", "Vylan")).toEqual({
      folderId: "existing",
      link: "https://drive/x",
    });
  });

  it("creates the folder when none exists", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return jsonResponse({ files: [] });
      return jsonResponse({ id: "fresh", webViewLink: "https://drive/f" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await ensureRootFolder("at", "Vylan")).toEqual({
      folderId: "fresh",
      link: "https://drive/f",
    });
  });
});
