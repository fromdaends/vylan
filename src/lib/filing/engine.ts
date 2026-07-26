// The FILING ENGINE — provider-agnostic orchestration.
//
// Owns: which documents leave (approved only), where they go (the firm's
// folder template), what they're called (the firm's name template), that
// nothing files twice (the ledger), and honest per-document reporting. It
// talks to a StorageConnector for provider IO and to injected deps for bytes
// and ledger writes — no database, no provider SDK, fully unit-testable.
//
// Correctness-critical invariants, enforced HERE regardless of caller:
//   * one run = one engagement = one client (mixed input aborts before any IO)
//   * only approved, non-duplicate checklist docs file; final documents only
//     when the engagement opted in
//   * a document already filed to this destination is skipped (the DB's
//     partial unique index is the backstop for races)
//   * collisions append " (2)", " (3)"…: NEVER overwrite
//   * one failed document never aborts the batch

import {
  StorageConflictError,
  type ConnectorContext,
  type FilingCandidate,
  type FilingOutcome,
  type FilingReport,
  type FilingSource,
  type SkipReason,
  type StorageConnector,
} from "./types";
import { renderFolderPath, renderFileName } from "./template";
import { MAX_FOLDER_SEGMENT_LEN, sanitizeCloudSegment } from "./sanitize";
import type { FilingLanguage, FilingTokenContext } from "./tokens";

// How many " (n)" suffixes to try before falling back to a short unique tag.
const MAX_COLLISION_ATTEMPTS = 50;

// Thrown when the input violates a correctness invariant (documents from two
// engagements, a client-name mismatch…). The whole run aborts — this is a bug
// or a data-integrity problem, never a per-document condition.
export class FilingGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilingGuardError";
  }
}

// ── Eligibility (pure) ──────────────────────────────────────────────────────

export type EligibilityDecision =
  | { eligible: true }
  | { eligible: false; reason: SkipReason };

/**
 * The filter IS the feature: only approved, non-duplicate checklist documents
 * — and final documents only behind the per-engagement opt-in — ever leave.
 */
export function decideEligibility(
  doc: FilingCandidate,
  opts: { fileFinalDocuments: boolean },
): EligibilityDecision {
  if (doc.source === "final") {
    if (!opts.fileFinalDocuments) {
      return { eligible: false, reason: "final_not_opted_in" };
    }
    if (!doc.storagePath) return { eligible: false, reason: "no_bytes" };
    return { eligible: true };
  }
  if (doc.isDuplicate) return { eligible: false, reason: "duplicate" };
  if (doc.reviewStatus === "rejected") {
    return { eligible: false, reason: "rejected" };
  }
  if (doc.reviewStatus !== "approved") {
    return { eligible: false, reason: "not_approved" };
  }
  if (!doc.storagePath) return { eligible: false, reason: "no_bytes" };
  return { eligible: true };
}

// ── Collision naming (pure) ─────────────────────────────────────────────────

/** "T4 - 2024.pdf" + 2 -> "T4 - 2024 (2).pdf" (suffix before the extension). */
export function withCounter(fileName: string, n: number): string {
  if (n <= 1) return fileName;
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  return `${base} (${n})${ext}`;
}

/** Last-resort unique name when 50 counters are somehow taken. */
export function withUniqueTag(fileName: string, fileId: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  return `${base} [${fileId.replace(/-/g, "").slice(0, 8)}]${ext}`;
}

// ── The run ─────────────────────────────────────────────────────────────────

// Ledger + bytes access, injected. The DB-backed implementation lives in the
// data layer; tests use an in-memory one.
//
// Upload lifecycle: beginUpload writes the INTENT (destination path + name)
// BEFORE any bytes move — a crash mid-upload leaves an auditable record of
// where the document was headed — then confirmFiled/markFailed settle it.
export type FilingLedger = {
  /** Has this document already been FILED to this destination? */
  alreadyFiled(source: FilingSource, fileId: string): Promise<boolean>;
  /** Record intent pre-upload; returns a handle for confirm/fail. */
  beginUpload(row: {
    source: FilingSource;
    fileId: string;
    folderPath: string;
    filedName: string;
  }): Promise<{ attemptId: string }>;
  /**
   * Settle the intent as FILED (with the final name — collisions may have
   * bumped it after intent was written). Returns "duplicate" when the DB's
   * partial unique index says another run filed this document first (the race
   * case) — the engine then reports already_filed rather than filed twice.
   */
  confirmFiled(
    attemptId: string,
    row: { filedName: string; providerFileId: string; link: string | null },
  ): Promise<"ok" | "duplicate">;
  /** Settle the intent as FAILED with a human-readable error. */
  markFailed(attemptId: string, error: string): Promise<void>;
  recordSkip(row: {
    source: FilingSource;
    fileId: string;
    reason: SkipReason;
  }): Promise<void>;
  /** A failure BEFORE intent was written (rendering, bytes download). */
  recordFailure(row: {
    source: FilingSource;
    fileId: string;
    error: string;
  }): Promise<void>;
};

export type FilingRunInput = {
  engagementId: string;
  // The client the engagement belongs to, as verified by the data layer
  // against the connection's firm. The engine re-asserts path correctness
  // against this name.
  clientName: string;
  fileFinalDocuments: boolean;
  folderTemplate: string;
  nameTemplate: string;
  language: FilingLanguage;
  candidates: Array<{
    doc: FilingCandidate;
    tokenContext: FilingTokenContext;
  }>;
};

export type FilingRunDeps = {
  connector: StorageConnector;
  ctx: ConnectorContext;
  ledger: FilingLedger;
  downloadBytes(storagePath: string): Promise<Uint8Array>;
};

/**
 * File one engagement's documents. Never throws for per-document problems —
 * those become 'failed' outcomes; throws FilingGuardError only for input that
 * violates a correctness invariant (nothing has been uploaded at that point
 * beyond, at worst, folder creation).
 */
export async function runFiling(
  deps: FilingRunDeps,
  input: FilingRunInput,
): Promise<FilingReport> {
  // Guard: one run, one engagement, one client. A candidate from another
  // engagement means the caller assembled the batch wrong — abort everything.
  for (const { doc, tokenContext } of input.candidates) {
    if (doc.engagementId !== input.engagementId) {
      throw new FilingGuardError(
        `candidate ${doc.fileId} belongs to engagement ${doc.engagementId}, run is for ${input.engagementId}`,
      );
    }
    if (tokenContext.clientName !== input.clientName) {
      throw new FilingGuardError(
        `candidate ${doc.fileId} carries client "${tokenContext.clientName}", run is for "${input.clientName}"`,
      );
    }
  }

  const outcomes: FilingOutcome[] = [];

  for (const { doc, tokenContext } of input.candidates) {
    const decision = decideEligibility(doc, {
      fileFinalDocuments: input.fileFinalDocuments,
    });
    if (!decision.eligible) {
      await deps.ledger.recordSkip({
        source: doc.source,
        fileId: doc.fileId,
        reason: decision.reason,
      });
      outcomes.push({
        fileId: doc.fileId,
        source: doc.source,
        status: "skipped",
        reason: decision.reason,
      });
      continue;
    }

    // Idempotency, check 1 (fast path). The partial unique index behind
    // recordFiled is the authoritative check 2.
    if (await deps.ledger.alreadyFiled(doc.source, doc.fileId)) {
      await deps.ledger.recordSkip({
        source: doc.source,
        fileId: doc.fileId,
        reason: "already_filed",
      });
      outcomes.push({
        fileId: doc.fileId,
        source: doc.source,
        status: "skipped",
        reason: "already_filed",
      });
      continue;
    }

    // From here on, any error is THIS document's failure, never the batch's.
    try {
      const segments = renderFolderPath(
        input.folderTemplate,
        tokenContext,
        input.language,
      );
      // Guard: the rendered path must place the file under THIS client.
      // Validation forces {client_name} into the template, so the client's
      // name must survive into some segment; a path without it means token
      // plumbing broke — do not upload anywhere. Compared in SANITIZED form
      // (the segments already are), and on a 24-char prefix so segment-length
      // truncation can't false-trip the guard.
      const safeClient = sanitizeCloudSegment(
        tokenContext.clientName,
        MAX_FOLDER_SEGMENT_LEN,
      );
      // A per-DOCUMENT failure (not a run abort): recorded, reported, and the
      // batch continues — but nothing uploads to an unverified path.
      if (
        safeClient &&
        !segments.some((s) => s.includes(safeClient.slice(0, 24).trim()))
      ) {
        throw new Error(
          `refusing to file: rendered path "${segments.join("/")}" does not contain the client name`,
        );
      }

      const fileName = renderFileName(
        input.nameTemplate,
        tokenContext,
        input.language,
      );

      const { folderId } = await deps.connector.ensureFolderPath(
        deps.ctx,
        segments,
      );

      const bytes = await deps.downloadBytes(doc.storagePath!);

      // INTENT first: the destination is on record before any bytes move.
      const folderPath = segments.join("/");
      const { attemptId } = await deps.ledger.beginUpload({
        source: doc.source,
        fileId: doc.fileId,
        folderPath,
        filedName: fileName,
      });

      try {
        // Collision loop: probe, then upload; a conflict (raced by another
        // writer between probe and upload) bumps the counter and retries.
        let uploaded: { providerFileId: string; link: string | null } | null =
          null;
        let finalName = fileName;
        for (
          let attempt = 1;
          attempt <= MAX_COLLISION_ATTEMPTS + 1;
          attempt++
        ) {
          finalName =
            attempt <= MAX_COLLISION_ATTEMPTS
              ? withCounter(fileName, attempt)
              : withUniqueTag(fileName, doc.fileId);
          if (
            attempt <= MAX_COLLISION_ATTEMPTS &&
            (await deps.connector.fileExists(deps.ctx, folderId, finalName))
          ) {
            continue;
          }
          try {
            uploaded = await deps.connector.uploadFile(
              deps.ctx,
              folderId,
              finalName,
              bytes,
              doc.mimeType,
            );
            break;
          } catch (e) {
            if (e instanceof StorageConflictError) continue;
            throw e;
          }
        }
        if (!uploaded) {
          throw new Error("no free name after collision attempts");
        }

        const recorded = await deps.ledger.confirmFiled(attemptId, {
          filedName: finalName,
          providerFileId: uploaded.providerFileId,
          link: uploaded.link,
        });
        if (recorded === "duplicate") {
          // Another run beat us to the ledger. The upload above may have left
          // a twin in the destination; we still NEVER delete — report as
          // already filed and let the report say so. (confirmFiled settles the
          // intent row as the skip record itself — no extra recordSkip here.)
          outcomes.push({
            fileId: doc.fileId,
            source: doc.source,
            status: "skipped",
            reason: "already_filed",
          });
          continue;
        }

        outcomes.push({
          fileId: doc.fileId,
          source: doc.source,
          status: "filed",
          folderPath,
          filedName: finalName,
          providerFileId: uploaded.providerFileId,
          link: uploaded.link,
        });
      } catch (e) {
        // Settle the open intent, then let the outer handler report.
        const message = e instanceof Error ? e.message : String(e);
        await deps.ledger.markFailed(attemptId, message);
        outcomes.push({
          fileId: doc.fileId,
          source: doc.source,
          status: "failed",
          error: message,
        });
        continue;
      }
    } catch (e) {
      if (e instanceof FilingGuardError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      await deps.ledger.recordFailure({
        source: doc.source,
        fileId: doc.fileId,
        error: message,
      });
      outcomes.push({
        fileId: doc.fileId,
        source: doc.source,
        status: "failed",
        error: message,
      });
    }
  }

  return {
    outcomes,
    filedCount: outcomes.filter((o) => o.status === "filed").length,
    skippedCount: outcomes.filter((o) => o.status === "skipped").length,
    failedCount: outcomes.filter((o) => o.status === "failed").length,
  };
}
