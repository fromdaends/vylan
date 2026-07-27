// Microsoft Graph connector (SharePoint document libraries + OneDrive) — the
// second real StorageConnector.
//
// Like every connector: thin, near-incapable of damage — no move, no rename,
// no overwrite, no permanent delete. The one sanctioned exception is
// trashFileById (recycle bin, recoverable; user-confirmed delete flow only).
// The engine owns selection/templates/idempotency.
//
// Graph realities handled here:
//   * One connector serves BOTH OneDrive and SharePoint: everything is
//     addressed against a DRIVE id (the user's OneDrive drive, or a site's
//     document-library drive). The connection's provider_config carries
//     { driveId, rootFolderId } chosen in the destination picker.
//   * Folders resolve BY PATH relative to the Vylan root item
//     (/drives/{d}/items/{root}:/A/B), fresh every run — never cached.
//     Missing levels are created child-by-child with
//     @microsoft.graph.conflictBehavior=fail; a 409 on create means another
//     writer won the race, so the child is re-fetched instead.
//   * Uploads use the simple PUT (…:/name:/content) with conflictBehavior=
//     fail: Vylan caps files at 25 MB, comfortably inside Graph's simple-
//     upload limit, and a same-name 409 maps to StorageConflictError so the
//     ENGINE renames — never replaces. This is real conflict semantics
//     (Drive, by contrast, allows twins).

import {
  StorageConflictError,
  type ConnectorContext,
  type StorageConnector,
  type UploadResult,
} from "../types";

const GRAPH = "https://graph.microsoft.com/v1.0";

export class MicrosoftGraphApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MicrosoftGraphApiError";
  }
}

function driveId(ctx: ConnectorContext): string {
  const id = ctx.config.driveId;
  if (typeof id !== "string" || !id) {
    throw new MicrosoftGraphApiError("connection has no drive id", 0);
  }
  return id;
}

function rootFolderId(ctx: ConnectorContext): string {
  const id = ctx.config.rootFolderId;
  if (typeof id !== "string" || !id) {
    throw new MicrosoftGraphApiError("connection has no root folder id", 0);
  }
  return id;
}

/** Encode one path segment for Graph path addressing ("Marie Tremblay" ->
 * "Marie%20Tremblay"). Graph decodes standard percent-encoding. */
export function encodeGraphSegment(segment: string): string {
  return encodeURIComponent(segment);
}

async function graphFetch(
  ctx: ConnectorContext,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${ctx.accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function graphJson(
  ctx: ConnectorContext,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await graphFetch(ctx, path, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      (json as { error?: { message?: string } }).error?.message ??
      `http ${res.status}`;
    throw new MicrosoftGraphApiError(`graph: ${detail}`, res.status);
  }
  return json;
}

/** GET an item by path relative to an item. Null on 404, throws otherwise. */
async function getByPath(
  ctx: ConnectorContext,
  drive: string,
  parentItemId: string,
  segments: string[],
): Promise<{ id: string } | null> {
  const rel = segments.map(encodeGraphSegment).join("/");
  const res = await graphFetch(
    ctx,
    `/drives/${drive}/items/${parentItemId}:/${rel}`,
  );
  if (res.status === 404) return null;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      (json as { error?: { message?: string } }).error?.message ??
      `http ${res.status}`;
    throw new MicrosoftGraphApiError(`graph: ${detail}`, res.status);
  }
  return typeof json.id === "string" ? { id: json.id } : null;
}

async function createChildFolder(
  ctx: ConnectorContext,
  drive: string,
  parentItemId: string,
  name: string,
): Promise<{ id: string } | "conflict"> {
  const res = await graphFetch(
    ctx,
    `/drives/${drive}/items/${parentItemId}/children`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    },
  );
  if (res.status === 409) return "conflict";
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.id !== "string") {
    const detail =
      (json as { error?: { message?: string } }).error?.message ??
      `http ${res.status}`;
    throw new MicrosoftGraphApiError(`graph: folder create: ${detail}`, res.status);
  }
  return { id: json.id };
}

export const microsoftConnector: StorageConnector = {
  provider: "microsoft",

  async ensureFolderPath(ctx, segments) {
    const drive = driveId(ctx);
    const root = rootFolderId(ctx);
    if (segments.length === 0) return { folderId: root };

    // Fast path: the whole chain already exists (one round trip).
    const whole = await getByPath(ctx, drive, root, segments);
    if (whole) return { folderId: whole.id };

    // Walk level by level, creating what's missing.
    let parent = root;
    for (const segment of segments) {
      const existing = await getByPath(ctx, drive, parent, [segment]);
      if (existing) {
        parent = existing.id;
        continue;
      }
      const created = await createChildFolder(ctx, drive, parent, segment);
      if (created === "conflict") {
        // Raced by another writer — the folder exists now; fetch it.
        const after = await getByPath(ctx, drive, parent, [segment]);
        if (!after) {
          throw new MicrosoftGraphApiError(
            `graph: folder "${segment}" conflicted but can't be fetched`,
            409,
          );
        }
        parent = after.id;
        continue;
      }
      parent = created.id;
    }
    return { folderId: parent };
  },

  async fileExists(ctx, folderId, name) {
    const drive = driveId(ctx);
    return (await getByPath(ctx, drive, folderId, [name])) !== null;
  },

  async trashFileById(ctx, providerFileId) {
    // Graph DELETE moves the item to the site/OneDrive RECYCLE BIN (recoverable),
    // not a permanent delete. 404 = already gone — the goal state holds.
    const drive = driveId(ctx);
    const res = await graphFetch(
      ctx,
      `/drives/${drive}/items/${encodeURIComponent(providerFileId)}`,
      { method: "DELETE" },
    );
    if (res.status === 404) return "missing";
    if (!res.ok && res.status !== 204) {
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new MicrosoftGraphApiError(
        `graph: trash failed: ${json.error?.message ?? `http ${res.status}`}`,
        res.status,
      );
    }
    return "trashed";
  },

  async uploadFile(ctx, folderId, name, bytes, mimeType): Promise<UploadResult> {
    const drive = driveId(ctx);
    const res = await graphFetch(
      ctx,
      `/drives/${drive}/items/${folderId}:/${encodeGraphSegment(name)}:/content?@microsoft.graph.conflictBehavior=fail`,
      {
        method: "PUT",
        headers: mimeType ? { "content-type": mimeType } : {},
        body: new Blob([new Uint8Array(bytes)]),
      },
    );
    if (res.status === 409) {
      // nameAlreadyExists under conflictBehavior=fail: the engine renames.
      throw new StorageConflictError();
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.id !== "string") {
      const detail =
        (json as { error?: { message?: string } }).error?.message ??
        `http ${res.status}`;
      throw new MicrosoftGraphApiError(`graph: upload failed: ${detail}`, res.status);
    }
    return {
      providerFileId: json.id,
      link: typeof json.webUrl === "string" ? json.webUrl : null,
    };
  },
};

// ── Destination discovery + root folder (used by the picker action) ─────────

export type MicrosoftDestinationList = {
  // The signed-in user's own OneDrive, when they have one (null for accounts
  // without a provisioned drive).
  onedrive: { driveId: string; label: string } | null;
  // SharePoint sites the user can reach. Empty for personal accounts.
  sites: Array<{ siteId: string; name: string; webUrl: string }>;
};

export async function listMicrosoftDestinations(
  ctx: ConnectorContext,
): Promise<MicrosoftDestinationList> {
  let onedrive: MicrosoftDestinationList["onedrive"] = null;
  try {
    const me = await graphJson(ctx, "/me/drive?$select=id,driveType,owner");
    if (typeof me.id === "string") {
      onedrive = { driveId: me.id, label: "OneDrive" };
    }
  } catch {
    // No provisioned OneDrive (some work accounts) — sites may still work.
  }

  let sites: MicrosoftDestinationList["sites"] = [];
  try {
    // search=* lists sites the user can access. Personal accounts 4xx here —
    // that's fine, they file to OneDrive.
    const res = await graphJson(
      ctx,
      "/sites?search=*&$select=id,displayName,name,webUrl&$top=50",
    );
    const value = Array.isArray(res.value)
      ? (res.value as Array<Record<string, unknown>>)
      : [];
    sites = value
      .filter((s) => typeof s.id === "string")
      .map((s) => ({
        siteId: s.id as string,
        name:
          (typeof s.displayName === "string" && s.displayName) ||
          (typeof s.name === "string" && s.name) ||
          "SharePoint",
        webUrl: typeof s.webUrl === "string" ? s.webUrl : "",
      }));
  } catch {
    sites = [];
  }

  return { onedrive, sites };
}

export type MicrosoftLibrary = { driveId: string; name: string };

/** Document libraries (drives) of one SharePoint site. */
export async function listSiteLibraries(
  ctx: ConnectorContext,
  siteId: string,
): Promise<MicrosoftLibrary[]> {
  const res = await graphJson(
    ctx,
    `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,driveType`,
  );
  const value = Array.isArray(res.value)
    ? (res.value as Array<Record<string, unknown>>)
    : [];
  return value
    .filter((d) => typeof d.id === "string" && d.driveType === "documentLibrary")
    .map((d) => ({
      driveId: d.id as string,
      name: typeof d.name === "string" ? d.name : "Documents",
    }));
}

/**
 * Create-or-find the "Vylan" root folder at the top of the chosen drive.
 * conflictBehavior=fail + refetch keeps it reuse-first, so reconnecting or
 * re-picking never spawns "Vylan 1".
 */
export async function ensureMicrosoftRootFolder(
  ctx: ConnectorContext,
  drive: string,
  name: string,
): Promise<{ folderId: string; link: string | null }> {
  const existing = await graphFetch(
    ctx,
    `/drives/${drive}/root:/${encodeGraphSegment(name)}`,
  );
  if (existing.ok) {
    const json = (await existing.json()) as Record<string, unknown>;
    if (typeof json.id === "string") {
      return {
        folderId: json.id,
        link: typeof json.webUrl === "string" ? json.webUrl : null,
      };
    }
  }
  const res = await graphFetch(ctx, `/drives/${drive}/root/children`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
  if (res.status === 409) {
    // Raced — fetch what exists now.
    const after = await graphFetch(
      ctx,
      `/drives/${drive}/root:/${encodeGraphSegment(name)}`,
    );
    const json = (await after.json().catch(() => ({}))) as Record<string, unknown>;
    if (after.ok && typeof json.id === "string") {
      return {
        folderId: json.id,
        link: typeof json.webUrl === "string" ? json.webUrl : null,
      };
    }
    throw new MicrosoftGraphApiError("graph: root folder conflicted", 409);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.id !== "string") {
    const detail =
      (json as { error?: { message?: string } }).error?.message ??
      `http ${res.status}`;
    throw new MicrosoftGraphApiError(`graph: root folder create: ${detail}`, res.status);
  }
  return {
    folderId: json.id,
    link: typeof json.webUrl === "string" ? json.webUrl : null,
  };
}
