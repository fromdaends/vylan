// Cross-statement checks for bank/credit-card statement sets: balance chaining
// and period coverage. PURE — no I/O, no model calls.
//
// Division of labour (the lesson this feature is built on): the MODEL only
// transcribes what is printed on each statement — account number, period
// dates, opening and closing balances, nulling anything not clearly legible.
// The DECISIONS all happen here, in arithmetic:
//   * consecutive statements of one account must chain — closing balance of
//     one equals opening balance of the next, to the cent;
//   * consecutive periods must touch — a hole between them is a missing
//     statement, reported as the uncovered date span (cycle-aware: statements
//     run Apr 27 – May 26, so calendar-month names would lie).
// Arithmetic doesn't hallucinate, doesn't get lazy on file 27, and is exactly
// as reliable on a 12-statement year as on a 2-statement pair.

// One statement as extracted by the set review. A single FILE can contain
// several statements (a year in one PDF) and one statement can span files —
// this is per STATEMENT, anchored to the file it starts in.
export type ExtractedStatement = {
  file_id: string | null;
  // Account identifier AS PRINTED (masked forms like "⋯4821" included).
  account_ref: string | null;
  // ISO dates as printed on the statement header.
  period_start: string | null;
  period_end: string | null;
  // Balances exactly as printed. Negative is legal (overdraft, credit card).
  opening_balance: number | null;
  closing_balance: number | null;
};

export type ChainFinding = {
  kind: "gap" | "balance_break";
  account_ref: string | null;
  // The two printed dates bounding the problem.
  from: string;
  to: string;
  // balance_break only.
  prev_closing?: number;
  next_opening?: number;
  delta_cents?: number;
  // Short heading for the summary UI ("Missing statement"). The accountant
  // scans these; the detail below carries the specifics.
  label_en: string;
  label_fr: string;
  // The specifics, without repeating the label.
  detail_en: string;
  detail_fr: string;
  // The full self-contained sentence — used for the flags array / audit trail,
  // where there is no label beside it to give context.
  text_en: string;
  text_fr: string;
};

export type ChainCoverage = {
  account_ref: string | null;
  start: string;
  end: string;
  statements: number;
  label_en: string;
  label_fr: string;
  detail_en: string;
  detail_fr: string;
  text_en: string;
  text_fr: string;
};

// Periods that merely touch or sit a few days apart are one continuous run —
// banks shift cycle boundaries around weekends/holidays. Beyond this many
// uncovered days, a statement is genuinely missing.
export const PERIOD_GRACE_DAYS = 7;

// Adjacent periods overlapping by more than this many days mean the group is
// NOT one account's sequence (two accounts sharing a ref bucket, or a
// mis-read) — chaining such a group would produce confident nonsense, so the
// whole group is skipped instead.
export const OVERLAP_TOLERANCE_DAYS = 5;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseIso(d: string | null): number | null {
  if (!d) return null;
  const m = ISO_RE.exec(d);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(aMs: number, bMs: number): number {
  return Math.round((bMs - aMs) / DAY_MS);
}

// Money compared in integer cents — float equality on 1234.56 is a bug farm.
function cents(v: number): number {
  return Math.round(v * 100);
}

// "21691 09441 22" -> "216910944122"; "⋯4821" / "****4821" -> "4821".
// Returns null when nothing identifying survives.
export function normalizeAccountRef(ref: string | null): string | null {
  if (!ref) return null;
  const digits = ref.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

// Masked and full forms of the same account must land in one bucket:
// "4821" (masked) matches "216910944821" (full) because one ends with the
// other. Buckets key on the SHORTEST ref that matches.
function sameAccount(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function fmtDate(iso: string, locale: "en" | "fr"): string {
  const ms = parseIso(iso);
  if (ms == null) return iso;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(ms + 12 * 60 * 60 * 1000));
}

function fmtMoney(v: number, locale: "en" | "fr"): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(v);
}

// "⋯4821" — the last digits, for prose. Never the full number (the finding
// text can end up in front of clients via the accountant pasting it).
function shortRef(normalized: string | null): string | null {
  if (!normalized) return null;
  return `⋯${normalized.slice(-4)}`;
}

function spanLabel(days: number, locale: "en" | "fr"): string {
  if (days >= 21) {
    const months = Math.max(1, Math.round(days / 30.44));
    return locale === "fr"
      ? `environ ${months} mois`
      : `about ${months} month${months === 1 ? "" : "s"}`;
  }
  return locale === "fr" ? `${days} jours` : `${days} days`;
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

type Chainable = {
  st: ExtractedStatement;
  startMs: number;
  endMs: number;
  ref: string | null;
};

export function analyzeStatements(statements: ExtractedStatement[]): {
  findings: ChainFinding[];
  coverage: ChainCoverage[];
} {
  // Only statements whose period is fully known participate — a null date can
  // never manufacture a finding.
  const usable: Chainable[] = [];
  for (const st of statements) {
    const startMs = parseIso(st.period_start);
    const endMs = parseIso(st.period_end);
    if (startMs == null || endMs == null || endMs < startMs) continue;
    usable.push({ st, startMs, endMs, ref: normalizeAccountRef(st.account_ref) });
  }
  if (usable.length < 2) return { findings: [], coverage: [] };

  // Group by account. Masked/full forms merge via sameAccount; statements with
  // no readable ref form ONE unidentified bucket (most single-account sets).
  const groups: Chainable[][] = [];
  for (const c of usable) {
    const home = groups.find((g) => {
      const gRef = g[0]!.ref;
      if (c.ref == null || gRef == null) return c.ref == null && gRef == null;
      return sameAccount(c.ref, gRef);
    });
    if (home) home.push(c);
    else groups.push([c]);
  }

  const findings: ChainFinding[] = [];
  const coverage: ChainCoverage[] = [];

  for (const group of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    // Overlap guard. The unidentified bucket gets ZERO tolerance: overlapping
    // periods with no account numbers is almost certainly two accounts, and a
    // false "missing statement" email is the classifier sin this session has
    // been about.
    const unidentified = group[0]!.ref == null;
    const tolerance = unidentified ? 0 : OVERLAP_TOLERANCE_DAYS;
    let overlapping = false;
    for (let i = 1; i < group.length; i++) {
      if (daysBetween(group[i]!.startMs, group[i - 1]!.endMs) > tolerance) {
        overlapping = true;
        break;
      }
    }
    if (overlapping) continue;

    const refShort = shortRef(group[0]!.ref);
    const acctEn = refShort ? ` for account ${refShort}` : "";
    const acctFr = refShort ? ` pour le compte ${refShort}` : "";
    let gaps = 0;

    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1]!;
      const next = group[i]!;
      const holeDays = daysBetween(prev.endMs, next.startMs) - 1;

      if (holeDays > PERIOD_GRACE_DAYS) {
        gaps += 1;
        findings.push({
          kind: "gap",
          account_ref: refShort,
          from: prev.st.period_end!,
          to: next.st.period_start!,
          label_en: "Statement missing",
          label_fr: "Relevé manquant",
          detail_en: `${fmtDate(prev.st.period_end!, "en")} – ${fmtDate(next.st.period_start!, "en")} (${spanLabel(holeDays, "en")})${refShort ? ` · account ${refShort}` : ""}`,
          detail_fr: `${fmtDate(prev.st.period_end!, "fr")} – ${fmtDate(next.st.period_start!, "fr")} (${spanLabel(holeDays, "fr")})${refShort ? ` · compte ${refShort}` : ""}`,
          text_en: `A statement appears to be missing between ${fmtDate(prev.st.period_end!, "en")} and ${fmtDate(next.st.period_start!, "en")} (${spanLabel(holeDays, "en")})${acctEn}.`,
          text_fr: `Un relevé semble manquer entre le ${fmtDate(prev.st.period_end!, "fr")} et le ${fmtDate(next.st.period_start!, "fr")} (${spanLabel(holeDays, "fr")})${acctFr}.`,
        });
        // Across a hole the balances are EXPECTED to differ — never also
        // report a break for the same seam.
        continue;
      }

      const close = prev.st.closing_balance;
      const open = next.st.opening_balance;
      if (close == null || open == null) continue;
      if (cents(close) !== cents(open)) {
        const delta = Math.abs(cents(open) - cents(close)) / 100;
        findings.push({
          kind: "balance_break",
          account_ref: refShort,
          from: prev.st.period_end!,
          to: next.st.period_start!,
          prev_closing: close,
          next_opening: open,
          delta_cents: cents(open) - cents(close),
          label_en: "Balances don't chain",
          label_fr: "Soldes non concordants",
          detail_en: `Closes ${fmtMoney(close, "en")} on ${fmtDate(prev.st.period_end!, "en")}, next opens ${fmtMoney(open, "en")} · ${fmtMoney(delta, "en")} difference${refShort ? ` · account ${refShort}` : ""}`,
          detail_fr: `Ferme à ${fmtMoney(close, "fr")} le ${fmtDate(prev.st.period_end!, "fr")}, le suivant ouvre à ${fmtMoney(open, "fr")} · écart de ${fmtMoney(delta, "fr")}${refShort ? ` · compte ${refShort}` : ""}`,
          text_en: `Balances don't chain${acctEn}: the statement ending ${fmtDate(prev.st.period_end!, "en")} closes at ${fmtMoney(close, "en")} but the next one opens at ${fmtMoney(open, "en")} (a ${fmtMoney(delta, "en")} difference) — a statement or pages may be missing.`,
          text_fr: `Les soldes ne s'enchaînent pas${acctFr} : le relevé se terminant le ${fmtDate(prev.st.period_end!, "fr")} ferme à ${fmtMoney(close, "fr")} mais le suivant ouvre à ${fmtMoney(open, "fr")} (écart de ${fmtMoney(delta, "fr")}) — un relevé ou des pages pourraient manquer.`,
        });
      }
    }

    // Positive coverage line — the "what did we actually receive" map. Only
    // meaningful once a real run of statements exists.
    if (group.length >= 2) {
      const start = group[0]!.st.period_start!;
      const end = group[group.length - 1]!.st.period_end!;
      const n = group.length;
      const gapsEn =
        gaps === 0 ? "no gaps between them" : `${gaps} gap${gaps === 1 ? "" : "s"}`;
      const gapsFr = gaps === 0 ? "sans trou" : `${gaps} trou${gaps === 1 ? "" : "s"}`;
      // Terser for the labelled detail row, where "Coverage" already supplies
      // the context that the standalone sentence has to carry itself.
      const gapsShortEn = gaps === 0 ? "no gaps" : `${gaps} gap${gaps === 1 ? "" : "s"}`;
      const gapsShortFr = gapsFr;
      coverage.push({
        account_ref: refShort,
        start,
        end,
        statements: n,
        label_en: "Coverage",
        label_fr: "Couverture",
        detail_en: `${fmtDate(start, "en")} – ${fmtDate(end, "en")} · ${n} statements · ${gapsShortEn}${refShort ? ` · account ${refShort}` : ""}`,
        detail_fr: `${fmtDate(start, "fr")} – ${fmtDate(end, "fr")} · ${n} relevés · ${gapsShortFr}${refShort ? ` · compte ${refShort}` : ""}`,
        text_en: `Statements${acctEn} cover ${fmtDate(start, "en")} – ${fmtDate(end, "en")} (${n} statements, ${gapsEn}).`,
        text_fr: `Les relevés${acctFr} couvrent du ${fmtDate(start, "fr")} au ${fmtDate(end, "fr")} (${n} relevés, ${gapsFr}).`,
      });
    }
  }

  return { findings, coverage };
}

// Tolerant parse of the model's raw statements array — junk in, nothing out.
// Mirrors parseSetAssessment's philosophy: validate every field, drop entries
// that don't hold together, never throw.
export function parseExtractedStatements(
  raw: unknown,
  fileIds: string[],
): ExtractedStatement[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedStatement[] = [];
  for (const entry of raw.slice(0, 40)) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const idx =
      typeof r.image_index === "number" && Number.isInteger(r.image_index)
        ? r.image_index
        : null;
    const file_id =
      idx != null && idx >= 1 && idx <= fileIds.length
        ? fileIds[idx - 1]!
        : null;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const period_start = str(r.period_start);
    const period_end = str(r.period_end);
    // Dates must be ISO-shaped or they're dropped to null (never "May 26").
    out.push({
      file_id,
      account_ref: str(r.account_ref),
      period_start: period_start && ISO_RE.test(period_start) ? period_start : null,
      period_end: period_end && ISO_RE.test(period_end) ? period_end : null,
      opening_balance: num(r.opening_balance),
      closing_balance: num(r.closing_balance),
    });
  }
  return out;
}
