// Filing tokens — the vocabulary of the folder + naming templates.
//
// Pure and client-safe (imported by the live-preview component as well as the
// server engine). A token renders from a FilingTokenContext, which the data
// layer builds per document; label-like values (doc type, category) render in
// the firm's chosen filing LANGUAGE — folder names must be stable per firm,
// never vary per viewing user.

import type { DocType } from "@/lib/db/templates";
import {
  DOC_TYPE_LABELS,
  docTypeGroupLabel,
  type DocTypeGroup,
} from "@/lib/doc-types";

export type FilingLanguage = "en" | "fr";

// Everything token rendering needs about one document-in-context. All fields
// are plain serializable values so a server page can hand a context to the
// client-side live preview.
export type FilingTokenContext = {
  clientName: string;
  clientType: "individual" | "business";
  firmName: string;
  engagementTitle: string;
  // Classification (null when the AI hasn't identified the document).
  docTypeCode: string | null;
  docConfidence: number | null;
  // Resolved via the year chain: document year -> engagement tax year ->
  // title year -> due-date year -> null.
  year: number | null;
  issuerName: string | null;
  partyName: string | null;
  period: string | null;
  // "YYYY-MM-DD" — the date read off the document, else the upload date.
  date: string;
  originalName: string;
};

// Mirrors the display-name builder (lib/ai/display-name.ts): below this
// classifier confidence — or for unknown/other — the TYPE is not trusted in a
// name, and the generic label is used instead.
const MIN_CONFIDENCE = 0.5;
const GENERIC_LABEL = "Document";

// Fallback folder name when a folder-context token has no value (a document
// with no detectable year, an unclassified category). One concept, one word.
export const UNSORTED_LABEL: Record<FilingLanguage, string> = {
  en: "Unsorted",
  fr: "Non classé",
};

function trustedDocType(ctx: FilingTokenContext): DocType | null {
  const code = ctx.docTypeCode;
  if (
    !code ||
    code === "unknown" ||
    code === "other" ||
    (ctx.docConfidence ?? 0) < MIN_CONFIDENCE ||
    !(code in DOC_TYPE_LABELS)
  ) {
    return null;
  }
  return code as DocType;
}

// The short type handle used in names ("T4", "RL-1", "Bank statements") — the
// part of the official label before the " — " long title.
function docTypeShortLabel(
  ctx: FilingTokenContext,
  lang: FilingLanguage,
): string {
  const code = trustedDocType(ctx);
  if (!code) return GENERIC_LABEL;
  const full = DOC_TYPE_LABELS[code][lang];
  return full.split(" — ")[0].trim() || GENERIC_LABEL;
}

function categoryGroup(ctx: FilingTokenContext): DocTypeGroup | null {
  const code = trustedDocType(ctx);
  return code ? DOC_TYPE_LABELS[code].group : null;
}

// Last whitespace-separated word of the client's display name. Right for
// "Marc Tremblay" -> "Tremblay"; imperfect for company names ("Tremblay Inc"
// -> "Inc"), which the settings preview makes visible before anyone commits.
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

export type FilingTokenDef = {
  /** Renders the value, or null when this document simply doesn't have one. */
  render(ctx: FilingTokenContext, lang: FilingLanguage): string | null;
  /**
   * Folder-context fallback when render() is null: 'unsorted' substitutes the
   * localized Unsorted label (year, category — a file must land SOMEWHERE
   * deterministic); 'collapse' drops the token and its separators (detail,
   * period — fine to omit from a folder or name).
   */
  folderFallback: "unsorted" | "collapse";
};

// The one token vocabulary, shared by both templates. Deliberately flat + in
// plain snake_case — these appear verbatim in the firm-facing template UI.
export const FILING_TOKENS = {
  client_name: {
    render: (ctx) => ctx.clientName.trim() || null,
    folderFallback: "collapse",
  },
  client_lastname: {
    render: (ctx) => lastName(ctx.clientName) || null,
    folderFallback: "collapse",
  },
  client_type: {
    render: (ctx, lang) =>
      ctx.clientType === "business"
        ? lang === "fr"
          ? "Entreprises"
          : "Businesses"
        : lang === "fr"
          ? "Particuliers"
          : "Individuals",
    folderFallback: "collapse",
  },
  firm_name: {
    render: (ctx) => ctx.firmName.trim() || null,
    folderFallback: "collapse",
  },
  engagement_title: {
    render: (ctx) => ctx.engagementTitle.trim() || null,
    folderFallback: "collapse",
  },
  year: {
    render: (ctx) => (ctx.year != null ? String(ctx.year) : null),
    folderFallback: "unsorted",
  },
  category: {
    render: (ctx, lang) => {
      const group = categoryGroup(ctx);
      return group ? docTypeGroupLabel(group, lang) : null;
    },
    folderFallback: "unsorted",
  },
  doc_type: {
    // Never null: unidentified documents render the generic label, exactly
    // like Vylan's automatic display names.
    render: (ctx, lang) => docTypeShortLabel(ctx, lang),
    folderFallback: "collapse",
  },
  detail: {
    // Who this document is from/about: issuer (employer, bank) first — that is
    // what tells two T4s apart — falling back to the person named on it.
    render: (ctx) => ctx.issuerName?.trim() || ctx.partyName?.trim() || null,
    folderFallback: "collapse",
  },
  issuer: {
    render: (ctx) => ctx.issuerName?.trim() || null,
    folderFallback: "collapse",
  },
  period: {
    render: (ctx) => ctx.period?.trim() || null,
    folderFallback: "collapse",
  },
  date: {
    render: (ctx) => ctx.date || null,
    folderFallback: "collapse",
  },
  original_name: {
    render: (ctx) => {
      const n = ctx.originalName;
      const dot = n.lastIndexOf(".");
      const base = dot > 0 ? n.slice(0, dot) : n;
      return base.trim() || null;
    },
    folderFallback: "collapse",
  },
} satisfies Record<string, FilingTokenDef>;

export type FilingToken = keyof typeof FILING_TOKENS;

export const FILING_TOKEN_NAMES = Object.keys(FILING_TOKENS) as FilingToken[];

export function isFilingToken(name: string): name is FilingToken {
  return name in FILING_TOKENS;
}

/**
 * The year chain, resolved once per document by the data layer:
 * the year printed on the document, else the engagement's structured tax year,
 * else a single unambiguous 20xx in the engagement title, else the due date's
 * year, else null (folders then use the Unsorted label).
 */
export function resolveYear(input: {
  extractedYear: number | null;
  engagementTaxYear: number | null;
  titleYear: number | null;
  dueDate: string | null;
}): number | null {
  if (input.extractedYear != null) return input.extractedYear;
  if (input.engagementTaxYear != null) return input.engagementTaxYear;
  if (input.titleYear != null) return input.titleYear;
  if (input.dueDate) {
    const y = Number(input.dueDate.slice(0, 4));
    if (Number.isFinite(y) && y >= 2000 && y <= 2099) return y;
  }
  return null;
}
