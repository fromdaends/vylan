// Filed-copy removal — the one sanctioned "delete" in the filing system
// (founder decision, 2026-07-27). When an accountant deletes a document in
// Vylan and explicitly confirms it, the copy Vylan previously FILED moves to
// the storage provider's TRASH (recoverable — never a permanent delete).
//
// Hard bounds, in code not policy:
//   * only files with a ledger row saying VYLAN filed them, on the firm's
//     ACTIVE connection — an old disconnected connection's copies are
//     unreachable (its tokens are gone) and stay where they are;
//   * trash-by-provider-id only — no paths, no folders, no move, no rename;
//   * the Vylan-side delete NEVER depends on this succeeding: callers proceed
//     and report the storage outcome honestly.

import {
  getFiledCopyForFile,
  markFiledCopyRemoved,
  readActiveConnectionTokens,
} from "@/lib/db/filing";
import { googleDriveConnector } from "./connectors/google-drive";
import { microsoftConnector } from "./connectors/microsoft";
import { acquireGoogleConnectorContext } from "./google/connection";
import { acquireMicrosoftConnectorContext } from "./microsoft/connection";
import type { FilingSource } from "./types";

export type RemoveFiledCopyResult =
  // "trashed" = moved to the provider's trash; "already_gone" = the provider
  // no longer had it (firm cleaned it up themselves) — goal state holds.
  | { ok: true; outcome: "trashed" | "already_gone" }
  // not_filed = nothing to do (no ledger row on the active connection).
  | { ok: false; reason: "not_filed" | "reconnect_required" | "trash_failed" };

export async function removeFiledCopy(input: {
  firmId: string;
  userId: string | null;
  source: FilingSource;
  fileId: string;
}): Promise<RemoveFiledCopyResult> {
  const copy = await getFiledCopyForFile(input.firmId, input.source, input.fileId);
  if (!copy) return { ok: false, reason: "not_filed" };

  const read = await readActiveConnectionTokens(input.firmId);
  if (read.kind !== "ok" || read.conn.id !== copy.connectionId) {
    return { ok: false, reason: "not_filed" };
  }

  let outcome: "trashed" | "missing";
  try {
    if (read.conn.provider === "google_drive") {
      const acquired = await acquireGoogleConnectorContext(input.firmId);
      if (acquired.kind !== "ok") {
        return { ok: false, reason: "reconnect_required" };
      }
      outcome = await googleDriveConnector.trashFileById(
        acquired.ctx,
        copy.providerFileId,
      );
    } else if (read.conn.provider === "microsoft") {
      const acquired = await acquireMicrosoftConnectorContext(input.firmId);
      if (acquired.kind !== "ok") {
        return { ok: false, reason: "reconnect_required" };
      }
      outcome = await microsoftConnector.trashFileById(
        acquired.ctx,
        copy.providerFileId,
      );
    } else {
      return { ok: false, reason: "not_filed" };
    }
  } catch (e) {
    console.error("[filing] trash failed:", (e as Error).message);
    return { ok: false, reason: "trash_failed" };
  }

  await markFiledCopyRemoved(copy.ledgerId, input.userId);
  return {
    ok: true,
    outcome: outcome === "missing" ? "already_gone" : "trashed",
  };
}
