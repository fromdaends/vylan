// Build a clean, human display name for an uploaded file from the AI's
// classification — e.g. a client uploads "IMG_2931.PDF" and, once the
// classifier recognises it, we rename it to "T4 - 2024 - Hydro-Quebec.pdf".
//
// This is intentionally pure + dependency-light so it can be unit-tested
// directly and called from the classify worker. The result is stored on
// uploaded_files.display_name; callers fall back to original_filename when it's
// null (see fileDisplayName in db/uploaded-files).

import type { DocType } from "@/lib/db/templates";
import { DOC_TYPE_LABELS, docTypeLabel } from "@/lib/doc-types";

// Below this classifier confidence — or when the type is "unknown" — we DON'T
// rename. A messy-but-honest original name beats a confidently wrong one (e.g.
// labelling a T4A as "T4 - ...""). Tuned to match the UI, which already treats
// sub-0.5 as "not sure" elsewhere.
const MIN_CONFIDENCE = 0.5;

// Keep each name part short so the whole filename stays manageable and never
// trips an OS filename-length limit once the doc-type + year are added.
const MAX_PART_LEN = 48;

export type DisplayNameInput = {
  /** ai_classification: a DocType code, "unknown", or null. */
  documentType: string | null;
  /** ai_confidence (0–1) for the document type. */
  confidence: number | null;
  /** ai_extracted_fields.extracted_year. */
  extractedYear?: number | null;
  /** ai_extracted_fields.issuer_name (employer / bank / institution). */
  issuerName?: string | null;
  /** ai_extracted_fields.party_name (the taxpayer). */
  partyName?: string | null;
};

// Pull a sane file extension off the original name, lower-cased and including
// the dot — "IMG_2931.PDF" -> ".pdf", "scan" -> "", "weird.tar.gz" -> ".gz".
// Only accepts a short alphanumeric tail so a dotted prose filename like
// "John's 2024 return.final" doesn't turn into a bogus extension.
export function fileExtension(originalFilename: string): string {
  const dot = originalFilename.lastIndexOf(".");
  if (dot <= 0 || dot === originalFilename.length - 1) return "";
  const ext = originalFilename.slice(dot + 1);
  if (!/^[A-Za-z0-9]{1,8}$/.test(ext)) return "";
  return `.${ext.toLowerCase()}`;
}

// Tidy a free-text field read off the document into a filename-safe part:
// collapse whitespace, strip path separators / reserved chars / control bytes,
// cap the length. Accents are PRESERVED here (the display name is shown in the
// UI and delivered via a UTF-8 Content-Disposition, both of which handle them);
// the ZIP path applies its own ASCII transliteration for archive entry names.
function cleanPart(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[\x00-\x1f\x7f]/g, "")
    // Reserved / path chars become a space (a separator reads better than a
    // jammed-together word), then runs of whitespace collapse to one.
    .replace(/[\\/<>:"|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_PART_LEN).trim();
}

/**
 * Compute the auto-generated display name, or null to keep the original
 * filename. Pure: same inputs always give the same output.
 *
 * Format: "<Type> - <Year> - <Issuer/Party><.ext>", dropping any part that's
 * missing. Examples:
 *   T4, 2024, Hydro-Québec   -> "T4 - 2024 - Hydro-Québec.pdf"
 *   RL-1, 2024, (no issuer)  -> "RL-1 - 2024.pdf"
 *   Receipt, (no year), Costco -> "Receipt - Costco.pdf"
 *   unknown / low confidence -> null (keep original)
 */
export function buildDisplayName(
  input: DisplayNameInput,
  originalFilename: string,
  locale: "en" | "fr" = "en",
): string | null {
  const code = input.documentType;
  if (!code || code === "unknown") return null;
  if ((input.confidence ?? 0) < MIN_CONFIDENCE) return null;
  // Only rename to a type we have an official label for (guards against a
  // stray code the catalog doesn't know).
  if (!(code in DOC_TYPE_LABELS)) return null;

  // The short handle is the part before the " — " in the official title, e.g.
  // "T4", "RL-1", "Bank statements" — exactly what the preview grid shows.
  const shortLabel = docTypeLabel(code as DocType, locale).split(" — ")[0].trim();
  if (!shortLabel) return null;

  // Prefer the issuer (employer / bank) — that's what tells two T4s apart
  // within one client's file; fall back to the taxpayer's name.
  const who = cleanPart(input.issuerName) ?? cleanPart(input.partyName);
  const year =
    typeof input.extractedYear === "number" && Number.isFinite(input.extractedYear)
      ? String(input.extractedYear)
      : null;

  const base = [shortLabel, year, who].filter(Boolean).join(" - ");
  return `${base}${fileExtension(originalFilename)}`;
}
