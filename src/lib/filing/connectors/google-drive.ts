// Google Drive connector — the first real StorageConnector.
//
// Thin by design: the ENGINE owns selection, templates, naming, idempotency,
// and reporting; this adapter only knows how Drive spells "make this folder
// chain", "does this name exist here", "add this file" — and, the interface's
// one sanctioned exception, "move this Vylan-filed file to Drive's TRASH"
// (recoverable; used only by the user-confirmed delete flow). No move, no
// rename, no overwrite, no permanent delete.
//
// Drive realities handled here:
//   * drive.file scope: Vylan sees only what it created — the folder walk
//     starts at the connection's own root folder id (provider_config), and
//     every folder beneath it is app-created, hence visible.
//   * Folder resolution is BY NAME per level, resolved fresh every run (the
//     engine never caches folder ids across runs; a firm may have reorganized
//     — moving/renaming the ROOT is fine, its id stays stable).
//   * Drive happily stores two files with the same name in one folder, so
//     uploads can't hard-conflict; the engine's fileExists probe + the DB
//     ledger are the duplicate guards. A lost race means a twin, never an
//     overwrite.
//   * Uploads use the RESUMABLE protocol in one shot (initiate + single PUT):
//     the multipart endpoint caps at 5 MB, Vylan files go to 25 MB.
//   * supportsAllDrives=true on every call so a root living in a Shared Drive
//     works identically.

import {
  type ConnectorContext,
  type StorageConnector,
  type UploadResult,
} from "../types";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class GoogleDriveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleDriveApiError";
  }
}

// Escape a value for a Drive query string literal ('...'): backslashes and
// single quotes get a backslash. ("O'Brien Inc" is a real client name.)
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function rootFolderId(ctx: ConnectorContext): string {
  const id = ctx.config.rootFolderId;
  if (typeof id !== "string" || !id) {
    throw new GoogleDriveApiError("connection has no root folder id", 0);
  }
  return id;
}

async function driveFetch(
  ctx: ConnectorContext,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${ctx.accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

async function driveJson(
  ctx: ConnectorContext,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await driveFetch(ctx, url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      (json as { error?: { message?: string } }).error?.message ??
      `http ${res.status}`;
    throw new GoogleDriveApiError(`drive: ${detail}`, res.status);
  }
  return json;
}

/** Find a child by exact name under a parent. Returns the first match's id. */
async function findChild(
  ctx: ConnectorContext,
  parentId: string,
  name: string,
  foldersOnly: boolean,
): Promise<string | null> {
  const q = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(name)}'`,
    "trashed = false",
    ...(foldersOnly ? [`mimeType = '${FOLDER_MIME}'`] : []),
  ].join(" and ");
  const params = new URLSearchParams({
    q,
    fields: "files(id, name)",
    pageSize: "5",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const json = await driveJson(ctx, `${API}/files?${params.toString()}`);
  const files = Array.isArray(json.files)
    ? (json.files as Array<{ id?: unknown }>)
    : [];
  const id = files[0]?.id;
  return typeof id === "string" ? id : null;
}

async function createFolder(
  ctx: ConnectorContext,
  parentId: string,
  name: string,
): Promise<string> {
  const json = await driveJson(
    ctx,
    `${API}/files?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    },
  );
  if (typeof json.id !== "string") {
    throw new GoogleDriveApiError("drive: folder create returned no id", 500);
  }
  return json.id;
}

/**
 * Create the connection's ROOT folder at connect time ("Vylan", in My Drive).
 * Reuses an existing app-created folder of that name first, so reconnecting
 * never spawns "Vylan (2)". Exported for the OAuth callback route.
 */
export async function ensureRootFolder(
  accessToken: string,
  name: string,
): Promise<{ folderId: string; link: string | null }> {
  const ctx: ConnectorContext = { accessToken, config: {} };
  // App-created folders are the only ones drive.file can list — exactly the
  // reuse set we want. No parent constraint: the firm may have moved it.
  const q = [
    `name = '${escapeDriveQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
  ].join(" and ");
  const params = new URLSearchParams({
    q,
    fields: "files(id, name, webViewLink)",
    pageSize: "5",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const json = await driveJson(ctx, `${API}/files?${params.toString()}`);
  const files = Array.isArray(json.files)
    ? (json.files as Array<{ id?: unknown; webViewLink?: unknown }>)
    : [];
  if (typeof files[0]?.id === "string") {
    return {
      folderId: files[0].id,
      link:
        typeof files[0].webViewLink === "string" ? files[0].webViewLink : null,
    };
  }
  const created = await driveJson(
    ctx,
    `${API}/files?supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    },
  );
  if (typeof created.id !== "string") {
    throw new GoogleDriveApiError("drive: root folder create failed", 500);
  }
  return {
    folderId: created.id,
    link: typeof created.webViewLink === "string" ? created.webViewLink : null,
  };
}

export const googleDriveConnector: StorageConnector = {
  provider: "google_drive",

  async ensureFolderPath(ctx, segments) {
    let parent = rootFolderId(ctx);
    for (const segment of segments) {
      const existing = await findChild(ctx, parent, segment, true);
      parent = existing ?? (await createFolder(ctx, parent, segment));
    }
    return { folderId: parent };
  },

  async fileExists(ctx, folderId, name) {
    return (await findChild(ctx, folderId, name, false)) !== null;
  },

  async trashFileById(ctx, providerFileId) {
    // TRASH, never delete: files.update {trashed:true} is recoverable from
    // Drive's trash for ~30 days. 404 = already gone — the goal state holds.
    const res = await driveFetch(
      ctx,
      `${API}/files/${encodeURIComponent(providerFileId)}?supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
    if (res.status === 404) return "missing";
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new GoogleDriveApiError(
        `drive: trash failed: ${detail.slice(0, 200)}`,
        res.status,
      );
    }
    return "trashed";
  },

  async uploadFile(ctx, folderId, name, bytes, mimeType): Promise<UploadResult> {
    // Resumable, one-shot: initiate with the metadata, then a single PUT of
    // the whole body (25 MB max app-side — no chunking needed).
    const initiate = await driveFetch(
      ctx,
      `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          ...(mimeType ? { "x-upload-content-type": mimeType } : {}),
          "x-upload-content-length": String(bytes.byteLength),
        },
        body: JSON.stringify({ name, parents: [folderId] }),
      },
    );
    if (!initiate.ok) {
      const detail = await initiate.text().catch(() => "");
      throw new GoogleDriveApiError(
        `drive: upload initiate failed: ${detail.slice(0, 200)}`,
        initiate.status,
      );
    }
    const session = initiate.headers.get("location");
    if (!session) {
      throw new GoogleDriveApiError("drive: no resumable session URI", 500);
    }
    // Blob-wrapped: satisfies fetch's BodyInit across TS typed-array generics
    // (the repo-wide pattern — see xero/write.ts, quickbooks/client.ts).
    const put = await fetch(session, {
      method: "PUT",
      headers: mimeType ? { "content-type": mimeType } : {},
      body: new Blob([new Uint8Array(bytes)]),
    });
    const json = (await put.json().catch(() => ({}))) as Record<string, unknown>;
    if (!put.ok || typeof json.id !== "string") {
      const detail =
        (json as { error?: { message?: string } }).error?.message ??
        `http ${put.status}`;
      throw new GoogleDriveApiError(`drive: upload failed: ${detail}`, put.status);
    }
    return {
      providerFileId: json.id,
      link: typeof json.webViewLink === "string" ? json.webViewLink : null,
    };
  },
};
