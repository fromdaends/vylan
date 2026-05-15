// Minimal CSV parser. Handles:
//   * Comma-separated values
//   * Quoted fields (with escaped " as "")
//   * \n or \r\n line endings
//   * Trailing whitespace per cell
// Does NOT handle: single-quote enclosed fields, semicolon delimiters, BOM.
//
// If we hit any of those, swap in papaparse.

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM if present.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field.trim());
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export type ClientImportRow = {
  display_name: string;
  email: string | null;
  phone: string | null;
  type: "individual" | "business";
  locale: "fr" | "en";
  external_ref: string | null;
  notes: string | null;
};

export type ImportParseResult = {
  valid: ClientImportRow[];
  invalid: {
    row: number;
    raw: Record<string, string>;
    error: "missing_name";
  }[];
  headerWarnings: string[];
};

const HEADER_ALIASES: Record<string, keyof ClientImportRow | "skip"> = {
  name: "display_name",
  display_name: "display_name",
  client: "display_name",
  nom: "display_name",
  email: "email",
  courriel: "email",
  "e-mail": "email",
  phone: "phone",
  tel: "phone",
  telephone: "phone",
  téléphone: "phone",
  type: "type",
  language: "locale",
  langue: "locale",
  locale: "locale",
  external_ref: "external_ref",
  ref: "external_ref",
  reference: "external_ref",
  référence: "external_ref",
  notes: "notes",
  note: "notes",
};

function normalizeHeader(h: string): keyof ClientImportRow | "skip" | null {
  const k = h.toLowerCase().trim();
  if (k === "") return "skip";
  return HEADER_ALIASES[k] ?? null;
}

function normalizeType(v: string | undefined): "individual" | "business" {
  if (!v) return "individual";
  const k = v.toLowerCase().trim();
  if (
    k === "business" ||
    k === "entreprise" ||
    k === "société" ||
    k === "societe" ||
    k === "corp" ||
    k === "inc" ||
    k === "b"
  ) {
    return "business";
  }
  return "individual";
}

function normalizeLocale(v: string | undefined): "fr" | "en" {
  if (!v) return "fr";
  const k = v.toLowerCase().trim();
  if (k.startsWith("en") || k === "anglais" || k === "english") return "en";
  return "fr";
}

function nullify(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function parseClientCsv(csv: string): ImportParseResult {
  const rows = parseCsv(csv);
  const headerWarnings: string[] = [];

  if (rows.length === 0) {
    return { valid: [], invalid: [], headerWarnings: ["empty"] };
  }

  const headers = rows[0].map(normalizeHeader);
  const knownCount = headers.filter((h) => h && h !== "skip").length;
  if (knownCount === 0) {
    headerWarnings.push("no_recognized_columns");
  }
  rows[0].forEach((h, idx) => {
    if (headers[idx] === null) headerWarnings.push(`unknown_column:${h}`);
  });

  const valid: ClientImportRow[] = [];
  const invalid: ImportParseResult["invalid"] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const raw: Record<string, string> = {};
    const obj: Partial<ClientImportRow> = {};
    headers.forEach((key, idx) => {
      const value = cells[idx] ?? "";
      if (key && key !== "skip") {
        (obj as Record<string, unknown>)[key] = value;
      }
      raw[rows[0][idx] ?? `col${idx}`] = value;
    });

    const display_name = (obj.display_name as string | undefined)?.trim();
    if (!display_name) {
      invalid.push({ row: i + 1, raw, error: "missing_name" });
      continue;
    }

    valid.push({
      display_name,
      email: nullify(obj.email as string | undefined),
      phone: nullify(obj.phone as string | undefined),
      type: normalizeType(obj.type as string | undefined),
      locale: normalizeLocale(obj.locale as string | undefined),
      external_ref: nullify(obj.external_ref as string | undefined),
      notes: nullify(obj.notes as string | undefined),
    });
  }

  return { valid, invalid, headerWarnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV writer (used by /api/firm/export.zip to emit one CSV per table).
// RFC 4180-flavored:
//   * Fields containing comma, double-quote, CR, or LF are quoted.
//   * Embedded double-quotes are doubled.
//   * Line terminator is CRLF.
// ─────────────────────────────────────────────────────────────────────────────

export type CsvCell = string | number | boolean | Date | null | undefined;

const NEEDS_QUOTING = /[",\r\n]/;

function escapeCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === "boolean") {
    s = v ? "true" : "false";
  } else if (typeof v === "number") {
    s = Number.isFinite(v) ? String(v) : "";
  } else {
    s = v;
  }
  if (NEEDS_QUOTING.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvLine(cells: CsvCell[]): string {
  return cells.map(escapeCell).join(",") + "\r\n";
}

export function csvDocument(
  header: string[],
  rows: CsvCell[][],
): string {
  let out = csvLine(header);
  for (const row of rows) {
    out += csvLine(row);
  }
  return out;
}
