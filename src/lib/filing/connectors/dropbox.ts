// Dropbox connector — the third StorageConnector.
//
// Like every connector: thin, near-incapable of damage — no move, no rename,
// no overwrite, no permanent delete. The one sanctioned exception is
// trashFileById (Dropbox's delete keeps files recoverable for 30-180 days —
// its trash equivalent; user-confirmed delete flow only). The engine owns
// selection/templates/idempotency.
//
// Dropbox realities handled here:
//   * APP-FOLDER access: every path is RELATIVE to /Apps/<app name>, which is
//     the only place Vylan can see. The connection's root is "" — the folder
//     chain starts directly with the template's segments.
//   * Dropbox is PATH-native: the "folderId" our interface passes around IS
//     the folder path ("/Clients/Marie/2024"). Resolved fresh every run like
//     the other connectors (paths are deterministic from the template).
//   * files/upload with mode=add + autorename=false: a same-name upload
//     returns a conflict error, mapped to StorageConflictError so the ENGINE
//     renames — never replaces. (Uploads to 150 MB in one call; Vylan caps
//     at 25 MB.)
//   * Folder creation tolerates "already exists" conflicts (idempotent).

import {
  StorageConflictError,
  type ConnectorContext,
  type StorageConnector,
  type UploadResult,
} from "../types";

const API = "https://api.dropboxapi.com/2";
const CONTENT_API = "https://content.dropboxapi.com/2";

export class DropboxApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DropboxApiError";
  }
}

/** Join path segments into a Dropbox path ("/a/b/c"). Segments are already
 * sanitized by the engine; this only handles the separators. */
export function joinDropboxPath(segments: string[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.join("/");
}

// Dropbox HTTP-style errors arrive as JSON with a dotted error_summary
// ("path/conflict/folder/..."). This checks for a marker anywhere in it.
function summaryIncludes(json: unknown, marker: string): boolean {
  const summary = (json as { error_summary?: unknown })?.error_summary;
  return typeof summary === "string" && summary.includes(marker);
}

async function rpc(
  ctx: ConnectorContext,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export const dropboxConnector: StorageConnector = {
  provider: "dropbox",

  async ensureFolderPath(ctx, segments) {
    // Create each level; "conflict/folder" = it already exists (fine). The
    // returned handle IS the path — Dropbox addresses everything by path.
    let current = "";
    for (const segment of segments) {
      current = `${current}/${segment}`;
      const { status, json } = await rpc(ctx, "/files/create_folder_v2", {
        path: current,
        autorename: false,
      });
      if (status === 409 && summaryIncludes(json, "conflict")) continue;
      if (status >= 400) {
        throw new DropboxApiError(
          `dropbox: create folder failed: ${
            (json.error_summary as string) ?? `http ${status}`
          }`,
          status,
        );
      }
    }
    return { folderId: current };
  },

  async fileExists(ctx, folderId, name) {
    const { status, json } = await rpc(ctx, "/files/get_metadata", {
      path: `${folderId}/${name}`,
    });
    if (status === 409 && summaryIncludes(json, "not_found")) return false;
    if (status >= 400) {
      throw new DropboxApiError(
        `dropbox: metadata failed: ${
          (json.error_summary as string) ?? `http ${status}`
        }`,
        status,
      );
    }
    return true;
  },

  // Dropbox infers content type itself — the mime parameter is unused here
  // (the interface requires it; other providers send it as a header).
  async uploadFile(ctx, folderId, name, bytes): Promise<UploadResult> {
    const path = `${folderId}/${name}`;
    const res = await fetch(`${CONTENT_API}/files/upload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.accessToken}`,
        "content-type": "application/octet-stream",
        // Non-ASCII in the arg header must be escaped per Dropbox's HTTP rules.
        "dropbox-api-arg": JSON.stringify({
          path,
          mode: "add",
          autorename: false,
          mute: true,
        }).replace(/[\u007f-\uffff]/g, (c) =>
          "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
        ),
      },
      body: new Blob([new Uint8Array(bytes)]),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409 && summaryIncludes(json, "conflict")) {
      // Same name already there under mode=add — the engine renames.
      throw new StorageConflictError();
    }
    if (!res.ok || typeof json.id !== "string") {
      throw new DropboxApiError(
        `dropbox: upload failed: ${
          (json.error_summary as string) ?? `http ${res.status}`
        }`,
        res.status,
      );
    }
    // Dropbox returns no web URL; the app-folder file lives under
    // /Apps/<app>/<path> in the web UI. Deep-link the parent folder with the
    // file preselected. appFolderName comes from the connection config.
    const appFolder =
      typeof ctx.config.appFolderName === "string" && ctx.config.appFolderName
        ? `/Apps/${ctx.config.appFolderName}`
        : "";
    const link = appFolder
      ? `https://www.dropbox.com/home${encodeURI(appFolder + folderId)}?preview=${encodeURIComponent(name)}`
      : null;
    return { providerFileId: json.id, link };
  },

  async trashFileById(ctx, providerFileId) {
    // delete_v2 is Dropbox's trash: deleted files are recoverable from the
    // web UI ("Deleted files") for 30-180 days depending on plan — never a
    // permanent purge (that would be permanently_delete, which Vylan does not
    // call). Addressing by the stored file id ("id:...") survives renames.
    const { status, json } = await rpc(ctx, "/files/delete_v2", {
      path: providerFileId,
    });
    if (status === 409 && summaryIncludes(json, "not_found")) return "missing";
    if (status >= 400) {
      throw new DropboxApiError(
        `dropbox: delete failed: ${
          (json.error_summary as string) ?? `http ${status}`
        }`,
        status,
      );
    }
    return "trashed";
  },
};
