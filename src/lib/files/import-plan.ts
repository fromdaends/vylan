// Turning a dropped folder into an import plan.
//
// Pure — no DOM, no network, no database — so the decisions that actually
// determine what lands in a firm's Files can be tested directly. Every one of
// them is invisible in a screenshot and expensive to get wrong across a few
// thousand files at once.

import { isAllowedMime } from "@/lib/files/upload-limits";

// ── What gets skipped before anyone sees it ────────────────────────────────

// Operating-system litter. A firm's historical folders are full of it, and
// making the accountant tick past ".DS_Store" 400 times would be its own kind
// of insult.
const JUNK_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  "icon\r",
  ".localized",
]);

const JUNK_EXTENSIONS = new Set([
  "lnk", // Windows shortcut — points at a file, is not one
  "url",
  "webloc",
  "tmp",
  "ini",
  "db",
]);

export function isJunkFile(path: string): boolean {
  const leaf = path.split(/[\\/]/).pop() ?? "";
  const lower = leaf.toLowerCase();
  if (!leaf) return true;
  if (JUNK_NAMES.has(lower)) return true;
  // Dotfiles: resource forks (._foo), .gitkeep, editor droppings.
  if (leaf.startsWith(".")) return true;
  const dot = lower.lastIndexOf(".");
  if (dot > 0 && JUNK_EXTENSIONS.has(lower.slice(dot + 1))) return true;
  return false;
}

/**
 * Can this file actually be stored?
 *
 * The bucket accepts PDF, JPEG, PNG, WebP and HEIC and rejects everything else
 * outright — so a firm's historical .docx and .xlsx files CANNOT be imported
 * today. That is a real limit of the storage configuration, not of this code,
 * and the wizard names every skipped file rather than quietly dropping it: a
 * firm that thinks it imported ten years of work and actually imported half of
 * it is far worse off than one that was told.
 */
export function isImportableType(mimeType: string, name: string): boolean {
  if (mimeType && isAllowedMime(mimeType)) return true;
  // Browsers leave `type` empty for plenty of files; fall back to the
  // extension so a valid PDF is not rejected over a missing header.
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext);
}

// ── Grouping ───────────────────────────────────────────────────────────────

export type DroppedFile = {
  /** Path relative to the dropped folder, e.g. "Tremblay Inc/2023/t4.pdf". */
  path: string;
  name: string;
  size: number;
  mimeType: string;
};

export type SkipReason = "junk" | "unsupported_type" | "too_large" | "empty";

export type PlannedFile = DroppedFile & { skip?: SkipReason };

export type FolderGroup = {
  /** Top-level folder name — what gets matched to a client. */
  folder: string;
  files: PlannedFile[];
  /** Importable files only. */
  count: number;
  bytes: number;
  skipped: number;
};

/**
 * Group dropped files by their TOP-LEVEL folder, which is the unit a client is
 * mapped to.
 *
 * Files dropped at the root (no folder above them) land under "" and are shown
 * as an unnamed group the user must map or skip explicitly — never silently
 * attached to whichever client happened to sort first.
 */
export function planImport(
  files: DroppedFile[],
  maxBytes: number,
): FolderGroup[] {
  const byFolder = new Map<string, PlannedFile[]>();

  for (const f of files) {
    const segments = f.path.split(/[\\/]/).filter(Boolean);
    // Drop the leading folder the browser adds for the drop target itself when
    // it is the only wrapper, so "Clients/Tremblay/x.pdf" groups by "Tremblay"
    // rather than everything landing under "Clients".
    const folder = segments.length > 1 ? segments[0] : "";
    const planned: PlannedFile = { ...f };
    if (isJunkFile(f.path)) planned.skip = "junk";
    else if (f.size === 0) planned.skip = "empty";
    else if (f.size > maxBytes) planned.skip = "too_large";
    else if (!isImportableType(f.mimeType, f.name)) {
      planned.skip = "unsupported_type";
    }
    const list = byFolder.get(folder) ?? [];
    list.push(planned);
    byFolder.set(folder, list);
  }

  return [...byFolder.entries()]
    .map(([folder, list]) => ({
      folder,
      files: list,
      count: list.filter((f) => !f.skip).length,
      bytes: list.filter((f) => !f.skip).reduce((a, b) => a + b.size, 0),
      skipped: list.filter((f) => f.skip).length,
    }))
    // Biggest folders first: they are the ones worth mapping carefully, and the
    // ones where a wrong client costs the most.
    .sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder));
}

// ── Matching a folder name to a client ─────────────────────────────────────

/** Comparable form: lowercase, unaccented, no punctuation, no legal suffixes. */
function normalize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => !LEGAL_SUFFIXES.has(tok));
}

// Dropped before comparing: they carry no identity and would otherwise make
// every incorporated client look alike ("Tremblay Inc" vs "Gagnon Inc" would
// share a token and score a false partial match).
const LEGAL_SUFFIXES = new Set([
  "inc",
  "ltd",
  "ltee",
  "ltée",
  "llc",
  "llp",
  "corp",
  "co",
  "sa",
  "senc",
  "enr",
  "cie",
]);

export type ClientCandidate = { id: string; name: string };

export type FolderMatch = {
  clientId: string | null;
  /** 0–1. Only ever a SUGGESTION — nothing imports without a human choice. */
  confidence: number;
};

/**
 * Best-guess client for a folder name.
 *
 * Token overlap rather than edit distance: firms name folders "Tremblay Inc",
 * "Tremblay, Marie", "Marie Tremblay 2023" for the same client, and word
 * overlap handles reordering and extra words where character distance does not.
 *
 * The score is deliberately conservative and the UI treats anything below a
 * high bar as "please confirm". Nothing imports without an explicit mapping, so
 * the cost of a low guess is one dropdown; the cost of a confident wrong guess
 * is a client's documents filed under someone else's name.
 */
export function matchFolderToClient(
  folder: string,
  clients: ClientCandidate[],
): FolderMatch {
  const want = normalize(folder);
  if (want.length === 0 || clients.length === 0) {
    return { clientId: null, confidence: 0 };
  }
  const wantSet = new Set(want);

  let best: FolderMatch = { clientId: null, confidence: 0 };
  let runnerUp = 0;
  for (const c of clients) {
    const have = normalize(c.name);
    if (have.length === 0) continue;
    const haveSet = new Set(have);
    let shared = 0;
    for (const tok of wantSet) if (haveSet.has(tok)) shared++;
    if (shared === 0) continue;
    // Symmetric overlap: "Tremblay" vs "Marie Tremblay" should not score as
    // highly as an exact match, in either direction.
    const score = (2 * shared) / (wantSet.size + haveSet.size);
    if (score > best.confidence) {
      runnerUp = best.confidence;
      best = { clientId: c.id, confidence: score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // AMBIGUITY DEMOTES CONFIDENCE. A folder called "Tremblay" is a perfect match
  // for a client called "Tremblay Inc" once the legal suffix is stripped — and
  // an equally good one for "Tremblay Holdings" if the firm has both. Scoring
  // that 1.0 would pre-select one of them and file a client's entire history
  // under the wrong name with a green tick beside it.
  //
  // So when the runner-up is close behind, the match is reported as a
  // suggestion the human must confirm rather than an answer.
  if (best.clientId && runnerUp > 0 && runnerUp >= best.confidence * AMBIGUITY_RATIO) {
    return { clientId: best.clientId, confidence: Math.min(best.confidence, 0.5) };
  }
  return best;
}

// How close the second-best match has to be before the best one stops being
// trustworthy. 0.9 is deliberately strict: a near-tie between two clients is
// exactly the case where a confident guess is most damaging and a dropdown
// costs one click.
const AMBIGUITY_RATIO = 0.9;

/** Above this, the wizard pre-selects the match. Below, it asks. */
export const AUTO_MATCH_CONFIDENCE = 0.75;
