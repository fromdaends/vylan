// Cross-provider name sanitization for CLOUD filing.
//
// Different job than lib/zip.ts: ZIP entries transliterate to ASCII because
// unzip tools are unreliable with UTF-8 flags. All four cloud providers
// (Drive / Graph / Dropbox / SmartVault) handle Unicode names properly, and
// these files sync down onto accountants' desktops — so here accents are
// PRESERVED ("Hydro-Québec" stays "Hydro-Québec") and we sanitize to the
// UNION of the providers' + Windows/macOS filesystem rules, so one rendered
// name is valid everywhere:
//
//   * control chars stripped; \ / < > : " | ? * replaced with a space
//   * leading/trailing spaces and dots trimmed (Windows + OneDrive reject
//     trailing dots; Dropbox trims leading/trailing whitespace itself —
//     better we do it deterministically than let a provider mutate the name)
//   * Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
//     suffixed with an underscore
//   * length-capped (segments 100 chars, filename base 120) so full paths
//     stay comfortably under Windows' 260-char default limit

const ILLEGAL = /[\\/<>:"|?*]/g;
 
const CONTROL = /[\x00-\x1f\x7f]/g;

// Windows reserved device names — bare or with any extension ("CON.pdf" is
// just as broken as "CON"). Case-insensitive.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const MAX_FOLDER_SEGMENT_LEN = 100;
export const MAX_FILENAME_BASE_LEN = 120;

/**
 * Sanitize ONE path piece (a folder segment or a filename base — no
 * separators, no extension). Returns "" when nothing survives; the caller
 * decides the fallback.
 */
export function sanitizeCloudSegment(
  input: string | null | undefined,
  maxLen: number,
): string {
  let s = (input ?? "")
    .replace(CONTROL, "")
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Trim leading dots too: ".hidden" folders would vanish in most providers'
  // UIs and were never intended by a template.
  s = s.replace(/^[. ]+/, "").replace(/[. ]+$/, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[. ]+$/, "");
  if (!s) return "";
  // "CON" / "con.pdf"-style names: suffix the STEM so Windows sync clients
  // don't choke ("CON" -> "CON_").
  const stem = s.includes(".") ? s.slice(0, s.indexOf(".")) : s;
  if (RESERVED.test(stem)) {
    s = s.includes(".")
      ? `${stem}_${s.slice(s.indexOf("."))}`
      : `${s}_`;
  }
  return s;
}
