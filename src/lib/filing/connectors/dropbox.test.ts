import { afterEach, describe, expect, it, vi } from "vitest";
import { dropboxConnector, joinDropboxPath } from "./dropbox";
import { StorageConflictError, type ConnectorContext } from "../types";

const ctx: ConnectorContext = {
  accessToken: "at_test",
  config: { appFolderName: "Vylan" },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("joinDropboxPath", () => {
  it("builds app-folder-relative paths", () => {
    expect(joinDropboxPath([])).toBe("");
    expect(joinDropboxPath(["Clients", "Marie"])).toBe("/Clients/Marie");
  });
});

describe("ensureFolderPath", () => {
  it("creates each level, tolerating already-exists conflicts", async () => {
    const created: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { path: string };
      created.push(body.path);
      // "/Clients" already exists; deeper levels create fine.
      if (body.path === "/Clients") {
        return jsonResponse(
          { error_summary: "path/conflict/folder/..", error: {} },
          409,
        );
      }
      return jsonResponse({ metadata: { id: "id:x" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { folderId } = await dropboxConnector.ensureFolderPath(ctx, [
      "Clients",
      "Marie",
      "2024",
    ]);
    expect(folderId).toBe("/Clients/Marie/2024");
    expect(created).toEqual(["/Clients", "/Clients/Marie", "/Clients/Marie/2024"]);
  });

  it("surfaces non-conflict failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error_summary: "path/no_write_permission/.." }, 409),
      ),
    );
    await expect(
      dropboxConnector.ensureFolderPath(ctx, ["X"]),
    ).rejects.toThrow("no_write_permission");
  });
});

describe("fileExists", () => {
  it("true on metadata hit, false on not_found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { path: string };
        expect(body.path).toBe("/Clients/T4.pdf");
        return jsonResponse({ id: "id:y" });
      }),
    );
    expect(await dropboxConnector.fileExists(ctx, "/Clients", "T4.pdf")).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error_summary: "path/not_found/.." }, 409),
      ),
    );
    expect(await dropboxConnector.fileExists(ctx, "/Clients", "gone.pdf")).toBe(
      false,
    );
  });
});

describe("uploadFile", () => {
  it("uploads with mode=add, no autorename, and builds the web link", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("content.dropboxapi.com/2/files/upload");
      const arg = JSON.parse(
        String((init?.headers as Record<string, string>)["dropbox-api-arg"]),
      ) as Record<string, unknown>;
      expect(arg).toMatchObject({
        path: "/Clients/T4.pdf",
        mode: "add",
        autorename: false,
      });
      return jsonResponse({ id: "id:file9", path_display: "/Clients/T4.pdf" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dropboxConnector.uploadFile(
      ctx,
      "/Clients",
      "T4.pdf",
      new Uint8Array([1, 2, 3]),
      "application/pdf",
    );
    expect(result.providerFileId).toBe("id:file9");
    expect(result.link).toContain("/home/Apps/Vylan/Clients");
    expect(result.link).toContain("preview=T4.pdf");
  });

  it("escapes non-ASCII in the api-arg header", async () => {
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      const raw = (init?.headers as Record<string, string>)["dropbox-api-arg"];
      // The header must be pure ASCII (é escaped as é).
      expect(/^[\x20-\x7e]*$/.test(raw)).toBe(true);
      expect(raw).toContain("\\u00e9");
      return jsonResponse({ id: "id:x" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await dropboxConnector.uploadFile(
      ctx,
      "/Clients",
      "Reçu été.pdf",
      new Uint8Array(1),
      null,
    );
  });

  it("maps a same-name conflict to StorageConflictError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error_summary: "path/conflict/file/.." }, 409),
      ),
    );
    await expect(
      dropboxConnector.uploadFile(ctx, "/C", "x.pdf", new Uint8Array(1), null),
    ).rejects.toThrow(StorageConflictError);
  });
});

describe("trashFileById", () => {
  it("deletes by id (recoverable), missing on not_found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { path: string };
        expect(body.path).toBe("id:file9");
        return jsonResponse({ metadata: {} });
      }),
    );
    expect(await dropboxConnector.trashFileById(ctx, "id:file9")).toBe("trashed");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error_summary: "path_lookup/not_found/.." }, 409),
      ),
    );
    expect(await dropboxConnector.trashFileById(ctx, "id:gone")).toBe("missing");
  });
});
