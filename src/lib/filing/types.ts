// The filing engine's provider-agnostic contract.
//
// ONE engine, many connectors: the engine owns document selection, folder
// templates, naming, idempotency, and reporting; a connector is a thin adapter
// over one provider's API. The interface is deliberately incapable of damage:
// there is NO delete, NO move, NO rename, NO overwrite method — a connector
// can only resolve/create folders and ADD files. Collision behavior is
// "throw, never replace" (StorageConflictError), and the engine responds by
// picking a new name.

export type StorageProvider =
  | "google_drive"
  | "microsoft"
  | "dropbox"
  | "smartvault";

// Everything a connector call needs about the connection it is acting for.
// `config` is the connection's provider_config row (root folder id, drive id,
// site id, Dropbox namespace…) — opaque to the engine.
export type ConnectorContext = {
  accessToken: string;
  config: Record<string, unknown>;
};

export type UploadResult = {
  providerFileId: string;
  // A link to the file inside the provider's own UI, when the API returns one.
  link: string | null;
};

// Thrown by uploadFile when the provider reports a same-name conflict the
// connector refused to overwrite (a race with our own fileExists check, or a
// provider that rejects duplicates outright). The engine treats it as "try the
// next collision counter", never as an error.
export class StorageConflictError extends Error {
  constructor(message = "name already exists at destination") {
    super(message);
    this.name = "StorageConflictError";
  }
}

export interface StorageConnector {
  readonly provider: StorageProvider;

  /**
   * Resolve — creating any missing levels — the folder chain `segments` under
   * the connection's configured root, and return an opaque folder handle.
   * MUST resolve from the root every call (the engine never caches folder ids
   * across runs; a firm may have reorganized since the last run).
   */
  ensureFolderPath(
    ctx: ConnectorContext,
    segments: string[],
  ): Promise<{ folderId: string }>;

  /** Exact-name existence check inside a folder (drives collision counters). */
  fileExists(
    ctx: ConnectorContext,
    folderId: string,
    name: string,
  ): Promise<boolean>;

  /**
   * Add `bytes` as `name` inside `folderId`. ADD-only: on a same-name conflict
   * the connector MUST throw StorageConflictError rather than overwrite.
   */
  uploadFile(
    ctx: ConnectorContext,
    folderId: string,
    name: string,
    bytes: Uint8Array,
    mimeType: string | null,
  ): Promise<UploadResult>;
}

// ── Documents the engine files ──────────────────────────────────────────────

// Which table a document lives in: 'checklist' = uploaded_files (client
// uploads), 'final' = final_documents (the accountant's deliverables, filed
// only when the engagement opted in).
export type FilingSource = "checklist" | "final";

export type SkipReason =
  | "already_filed"
  | "not_approved"
  | "rejected"
  | "duplicate"
  | "final_not_opted_in"
  | "no_bytes";

// One candidate document, already joined with everything the token renderer
// needs. Built by the data layer; the engine never talks to the database
// directly.
export type FilingCandidate = {
  source: FilingSource;
  fileId: string;
  engagementId: string;
  storagePath: string | null;
  originalFilename: string;
  mimeType: string | null;
  // Checklist review state (finals are implicitly accountant-approved).
  reviewStatus: "pending" | "approved" | "rejected" | null;
  isDuplicate: boolean;
  // Classification-derived naming inputs (null when unclassified).
  docTypeCode: string | null;
  docConfidence: number | null;
  extractedYear: number | null;
  issuerName: string | null;
  partyName: string | null;
  accountOrPeriod: string | null;
  documentDate: string | null;
  uploadedAt: string;
};

export type FilingOutcome =
  | {
      fileId: string;
      source: FilingSource;
      status: "filed";
      folderPath: string;
      filedName: string;
      providerFileId: string;
      link: string | null;
    }
  | { fileId: string; source: FilingSource; status: "skipped"; reason: SkipReason }
  | { fileId: string; source: FilingSource; status: "failed"; error: string };

export type FilingReport = {
  outcomes: FilingOutcome[];
  filedCount: number;
  skippedCount: number;
  failedCount: number;
};
