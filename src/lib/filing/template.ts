// Template parsing, validation, and rendering for the filing engine.
//
// A template is literal text with {token} slots — the folder template is
// "/"-separated segments ("Clients/{client_name}/{year}/{category}"), the name
// template is one segment ("{doc_type} - {year} - {detail}"). Pure and
// client-safe: the settings page's live preview runs exactly this code in the
// browser, so what the preview shows IS what the engine will do.

import { fileExtension } from "@/lib/ai/display-name";
import {
  FILING_TOKENS,
  UNSORTED_LABEL,
  isFilingToken,
  type FilingLanguage,
  type FilingToken,
  type FilingTokenContext,
} from "./tokens";
import {
  MAX_FILENAME_BASE_LEN,
  MAX_FOLDER_SEGMENT_LEN,
  sanitizeCloudSegment,
} from "./sanitize";

// Hard shape limits, enforced at save AND at render (belt and braces — a
// template already stored before a rule tightened must still render sanely).
export const MAX_FOLDER_DEPTH = 8;

export type TemplatePart =
  | { kind: "literal"; text: string }
  | { kind: "token"; token: FilingToken };

// ── Parsing ─────────────────────────────────────────────────────────────────

// {anything} — validation decides whether "anything" is a known token.
const TOKEN_RE = /\{([a-z_]+)\}/g;

/** Split one segment into literal/token parts. Unknown tokens parse as
 * literals so rendering is total; validation reports them separately. */
export function parseSegment(segment: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const m of segment.matchAll(TOKEN_RE)) {
    if (m.index > last) {
      parts.push({ kind: "literal", text: segment.slice(last, m.index) });
    }
    const name = m[1];
    if (isFilingToken(name)) {
      parts.push({ kind: "token", token: name });
    } else {
      parts.push({ kind: "literal", text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    parts.push({ kind: "literal", text: segment.slice(last) });
  }
  return parts;
}

export function parseFolderTemplate(template: string): TemplatePart[][] {
  return template
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseSegment);
}

// ── Validation ──────────────────────────────────────────────────────────────

export type TemplateValidation =
  | { ok: true }
  | {
      ok: false;
      error:
        | "empty"
        | "unknown_token"
        | "too_deep"
        | "missing_client_token"
        | "no_output";
      // For unknown_token: the offending {name}s, shown to the firm.
      unknownTokens?: string[];
    };

function unknownTokensIn(template: string): string[] {
  const bad: string[] = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    if (!isFilingToken(m[1]) && !bad.includes(m[0])) bad.push(m[0]);
  }
  return bad;
}

/**
 * Folder template rules: non-empty, known tokens only, depth-capped, and it
 * MUST contain {client_name} — that is the wrong-client-folder guard. A path
 * that doesn't separate clients cannot be verified to carry the right
 * client's name, so it cannot be saved.
 */
export function validateFolderTemplate(template: string): TemplateValidation {
  const trimmed = template.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  const unknown = unknownTokensIn(trimmed);
  if (unknown.length > 0) {
    return { ok: false, error: "unknown_token", unknownTokens: unknown };
  }
  const segments = parseFolderTemplate(trimmed);
  if (segments.length === 0) return { ok: false, error: "empty" };
  if (segments.length > MAX_FOLDER_DEPTH) return { ok: false, error: "too_deep" };
  if (!trimmed.includes("{client_name}")) {
    return { ok: false, error: "missing_client_token" };
  }
  return { ok: true };
}

/** Name template rules: non-empty, known tokens only, and it must be able to
 * produce SOMETHING (at least one token or literal character). */
export function validateNameTemplate(template: string): TemplateValidation {
  const trimmed = template.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  const unknown = unknownTokensIn(trimmed);
  if (unknown.length > 0) {
    return { ok: false, error: "unknown_token", unknownTokens: unknown };
  }
  if (parseSegment(trimmed).length === 0) return { ok: false, error: "no_output" };
  return { ok: true };
}

// ── Rendering ───────────────────────────────────────────────────────────────

// Internal marker for "this token rendered empty". Control chars are stripped
// from token VALUES before insertion, so the marker can never occur naturally.
const EMPTY = "\u0000";
const SEPARATOR_CHAR = /[\s\-_.·—]/;

// Strip control characters from a token value so it can't smuggle the marker
// (full sanitization happens after assembly).
function cleanValue(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Collapse EMPTY markers together with their adjacent separator runs, keeping
 * one side's separator when real text remains on both sides:
 *   "T4 - ∅ - Hydro"  -> "T4 - Hydro"
 *   "T4 - ∅"          -> "T4"
 *   "Tremblay∅2024"   -> "Tremblay2024"
 */
export function collapseEmpties(rendered: string): string {
  let s = rendered;
  let idx = s.indexOf(EMPTY);
  while (idx !== -1) {
    let a = idx;
    while (a > 0 && SEPARATOR_CHAR.test(s[a - 1]!)) a--;
    let b = idx + 1;
    while (b < s.length && SEPARATOR_CHAR.test(s[b]!)) b++;
    // Keep the LEFT separator run when both sides still have content
    // (preserves the template's own separator style).
    const keepLeft = a > 0 && b < s.length ? s.slice(a, idx) : "";
    s = s.slice(0, a) + keepLeft + s.slice(b);
    idx = s.indexOf(EMPTY);
  }
  return s.replace(/\s+/g, " ").trim();
}

function renderParts(
  parts: TemplatePart[],
  ctx: FilingTokenContext,
  lang: FilingLanguage,
  folderContext: boolean,
): string {
  let out = "";
  for (const p of parts) {
    if (p.kind === "literal") {
      out += p.text;
      continue;
    }
    const def = FILING_TOKENS[p.token];
    const value = def.render(ctx, lang);
    if (value != null && value.trim() !== "") {
      out += cleanValue(value);
    } else if (folderContext && def.folderFallback === "unsorted") {
      // A folder must land somewhere deterministic: no year / no category
      // files under the localized Unsorted folder rather than one level up.
      out += UNSORTED_LABEL[lang];
    } else {
      out += EMPTY;
    }
  }
  return collapseEmpties(out);
}

/**
 * Render the folder template into sanitized path segments. Segments that
 * render empty (every token collapsed, no literal text) are dropped. Depth is
 * re-capped at render time.
 */
export function renderFolderPath(
  template: string,
  ctx: FilingTokenContext,
  lang: FilingLanguage,
): string[] {
  const segments = parseFolderTemplate(template);
  const out: string[] = [];
  for (const parts of segments) {
    const rendered = renderParts(parts, ctx, lang, true);
    const safe = sanitizeCloudSegment(rendered, MAX_FOLDER_SEGMENT_LEN);
    if (safe) out.push(safe);
    if (out.length >= MAX_FOLDER_DEPTH) break;
  }
  return out;
}

/**
 * Render the name template into a sanitized filename INCLUDING the original
 * file's extension. Never empty: when everything collapses, the localized
 * generic "Document" base is used.
 */
export function renderFileName(
  template: string,
  ctx: FilingTokenContext,
  lang: FilingLanguage,
): string {
  const rendered = renderParts(parseSegment(template.trim()), ctx, lang, false);
  // Trim trailing dots BEFORE the extension goes on ("Maple Inc." + ".pdf"
  // must not become "Maple Inc..pdf").
  const base =
    sanitizeCloudSegment(rendered, MAX_FILENAME_BASE_LEN) || "Document";
  return `${base}${fileExtension(ctx.originalName)}`;
}

/** The full destination as one display string ("Clients/Tremblay/2024/T4 - 2024.pdf"). */
export function renderFullPath(
  folderTemplate: string,
  nameTemplate: string,
  ctx: FilingTokenContext,
  lang: FilingLanguage,
): { segments: string[]; fileName: string } {
  return {
    segments: renderFolderPath(folderTemplate, ctx, lang),
    fileName: renderFileName(nameTemplate, ctx, lang),
  };
}
