// In-memory mock connector — the engine's test destination.
//
// Faithfully mimics the contract real connectors must honor: folders resolve
// by path, exact-name existence checks, ADD-only uploads that throw
// StorageConflictError on a same-name collision (never overwrite). Also lets
// tests inject per-file upload failures to prove one failure never aborts a
// batch. Not used in production.

import {
  StorageConflictError,
  type ConnectorContext,
  type StorageConnector,
  type UploadResult,
} from "../types";

export type MockFile = {
  name: string;
  bytes: Uint8Array;
  mimeType: string | null;
  providerFileId: string;
};

export class MockStorage {
  // folder path (joined with "/") -> folder id
  folders = new Map<string, string>();
  // folder id -> files by exact name
  files = new Map<string, Map<string, MockFile>>();
  // names that should fail upload with a generic error (partial-batch tests)
  failNames = new Set<string>();
  // count of uploadFile calls that ATTEMPTED a write (proves idempotent skips
  // never reach the provider)
  uploadAttempts = 0;
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  ensureFolder(pathKey: string): string {
    let id = this.folders.get(pathKey);
    if (!id) {
      id = this.id("folder");
      this.folders.set(pathKey, id);
      this.files.set(id, new Map());
    }
    return id;
  }

  /** Every file in the store as "path/name" -> file, for assertions. */
  allByPath(): Map<string, MockFile> {
    const byId = new Map<string, string>();
    for (const [path, id] of this.folders) byId.set(id, path);
    const out = new Map<string, MockFile>();
    for (const [folderId, files] of this.files) {
      const path = byId.get(folderId) ?? folderId;
      for (const f of files.values()) out.set(`${path}/${f.name}`, f);
    }
    return out;
  }
}

export function createMockConnector(store: MockStorage): StorageConnector {
  return {
    provider: "google_drive",

    async ensureFolderPath(_ctx: ConnectorContext, segments: string[]) {
      // Create every level like a real connector would.
      for (let i = 1; i < segments.length; i++) {
        store.ensureFolder(segments.slice(0, i).join("/"));
      }
      return { folderId: store.ensureFolder(segments.join("/")) };
    },

    async fileExists(_ctx, folderId, name) {
      return store.files.get(folderId)?.has(name) ?? false;
    },

    async uploadFile(_ctx, folderId, name, bytes, mimeType) {
      store.uploadAttempts += 1;
      if (store.failNames.has(name)) {
        throw new Error(`mock upload failure for ${name}`);
      }
      const files = store.files.get(folderId);
      if (!files) throw new Error(`unknown folder ${folderId}`);
      if (files.has(name)) {
        // The contract: NEVER overwrite — conflict is an exception the engine
        // resolves by renaming.
        throw new StorageConflictError();
      }
      const file: MockFile = {
        name,
        bytes,
        mimeType,
        providerFileId: `file_${folderId}_${files.size + 1}`,
      };
      files.set(name, file);
      const result: UploadResult = {
        providerFileId: file.providerFileId,
        link: `https://mock.storage/${encodeURIComponent(name)}`,
      };
      return result;
    },
  };
}
