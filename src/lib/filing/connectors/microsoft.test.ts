import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeGraphSegment,
  ensureMicrosoftRootFolder,
  listMicrosoftDestinations,
  listSiteLibraries,
  microsoftConnector,
} from "./microsoft";
import { StorageConflictError, type ConnectorContext } from "../types";

const ctx: ConnectorContext = {
  accessToken: "at_test",
  config: { driveId: "drv1", rootFolderId: "rootItem" },
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

describe("encodeGraphSegment", () => {
  it("percent-encodes spaces, accents, and hash marks", () => {
    expect(encodeGraphSegment("Marie Tremblay")).toBe("Marie%20Tremblay");
    expect(encodeGraphSegment("Reçu #4")).toBe("Re%C3%A7u%20%234");
  });
});

describe("ensureFolderPath", () => {
  it("returns via the whole-path fast path when the chain exists", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/drives/drv1/items/rootItem:/Clients/Marie");
      return jsonResponse({ id: "deep" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { folderId } = await microsoftConnector.ensureFolderPath(ctx, [
      "Clients",
      "Marie",
    ]);
    expect(folderId).toBe("deep");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates missing levels with conflictBehavior=fail", async () => {
    const created: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET") {
        // "Clients" exists; everything else (whole path, "Marie") 404s.
        if (url.endsWith(":/Clients")) return jsonResponse({ id: "fldClients" });
        return jsonResponse({ error: { message: "not found" } }, 404);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      created.push({ url, ...body });
      return jsonResponse({ id: "fldMarie" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { folderId } = await microsoftConnector.ensureFolderPath(ctx, [
      "Clients",
      "Marie",
    ]);
    expect(folderId).toBe("fldMarie");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: "Marie",
      "@microsoft.graph.conflictBehavior": "fail",
    });
    expect(String(created[0].url)).toContain("/items/fldClients/children");
  });

  it("re-fetches on a create race (409)", async () => {
    let getCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        getCalls += 1;
        // Whole-path probe and the first per-level probe 404; the post-race
        // re-fetch succeeds.
        return getCalls >= 3
          ? jsonResponse({ id: "raced" })
          : jsonResponse({}, 404);
      }
      return new Response(null, { status: 409 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { folderId } = await microsoftConnector.ensureFolderPath(ctx, ["A"]);
    expect(folderId).toBe("raced");
  });

  it("throws without a drive id", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      microsoftConnector.ensureFolderPath(
        { accessToken: "t", config: {} },
        ["A"],
      ),
    ).rejects.toThrow("no drive id");
  });
});

describe("fileExists", () => {
  it("true on 200, false on 404, path-addressed under the folder", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/drives/drv1/items/fld1:/T4%20-%202024.pdf");
      return jsonResponse({ id: "x" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await microsoftConnector.fileExists(ctx, "fld1", "T4 - 2024.pdf"),
    ).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 404)),
    );
    expect(await microsoftConnector.fileExists(ctx, "fld1", "gone.pdf")).toBe(
      false,
    );
  });
});

describe("uploadFile", () => {
  it("PUTs to :/name:/content with conflictBehavior=fail", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.method).toBe("PUT");
      expect(url).toContain("/items/fld1:/T4.pdf:/content");
      expect(url).toContain("conflictBehavior=fail");
      return jsonResponse({ id: "item9", webUrl: "https://sp/item9" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await microsoftConnector.uploadFile(
      ctx,
      "fld1",
      "T4.pdf",
      new Uint8Array([1, 2, 3]),
      "application/pdf",
    );
    expect(result).toEqual({ providerFileId: "item9", link: "https://sp/item9" });
  });

  it("maps a same-name 409 to StorageConflictError (the engine renames)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 409 })),
    );
    await expect(
      microsoftConnector.uploadFile(ctx, "fld1", "x.pdf", new Uint8Array(1), null),
    ).rejects.toThrow(StorageConflictError);
  });

  it("surfaces other failures with the provider's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { message: "quota exceeded" } }, 507),
      ),
    );
    await expect(
      microsoftConnector.uploadFile(ctx, "fld1", "x.pdf", new Uint8Array(1), null),
    ).rejects.toThrow("quota exceeded");
  });
});

describe("destination discovery", () => {
  it("lists OneDrive + sites, tolerating a sites failure", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/drive")) return jsonResponse({ id: "drvMe" });
      if (url.includes("/sites?search="))
        return jsonResponse({
          value: [
            { id: "site1", displayName: "Accounting", webUrl: "https://sp/acc" },
          ],
        });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const list = await listMicrosoftDestinations(ctx);
    expect(list.onedrive?.driveId).toBe("drvMe");
    expect(list.sites).toEqual([
      { siteId: "site1", name: "Accounting", webUrl: "https://sp/acc" },
    ]);
  });

  it("personal account: sites 4xx -> empty list, OneDrive still offered", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/drive")) return jsonResponse({ id: "drvMe" });
      return jsonResponse({ error: { message: "not supported" } }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);
    const list = await listMicrosoftDestinations(ctx);
    expect(list.onedrive?.driveId).toBe("drvMe");
    expect(list.sites).toEqual([]);
  });

  it("lists only documentLibrary drives of a site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          value: [
            { id: "d1", name: "Documents", driveType: "documentLibrary" },
            { id: "d2", name: "Other", driveType: "business" },
          ],
        }),
      ),
    );
    expect(await listSiteLibraries(ctx, "site1")).toEqual([
      { driveId: "d1", name: "Documents" },
    ]);
  });
});

describe("ensureMicrosoftRootFolder", () => {
  it("reuses an existing root folder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: "rootX", webUrl: "https://sp/v" })),
    );
    expect(await ensureMicrosoftRootFolder(ctx, "drv1", "Vylan")).toEqual({
      folderId: "rootX",
      link: "https://sp/v",
    });
  });

  it("creates when missing, and refetches on a 409 race", async () => {
    let phase = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        phase += 1;
        // First GET (existence probe) 404s; the post-409 refetch succeeds.
        return phase === 1
          ? jsonResponse({}, 404)
          : jsonResponse({ id: "racedRoot", webUrl: null });
      }
      return new Response(null, { status: 409 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await ensureMicrosoftRootFolder(ctx, "drv1", "Vylan")).toEqual({
      folderId: "racedRoot",
      link: null,
    });
  });
});
