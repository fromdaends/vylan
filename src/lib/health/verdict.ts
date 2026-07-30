// "Is anything silently not working?" — the pure half.
//
// WHY THIS EXISTS. Vylan degrades quietly by design, and that is the right
// instinct for a client-facing app: a missing API key makes extraction return
// null rather than crash, an unapplied migration makes a write no-op rather than
// 500, a stale cache makes the matcher find nothing rather than throw. Nobody
// sees a red screen.
//
// The cost is that the FOUNDER cannot tell either. Three separate times in one
// day, something was doing nothing rather than failing: an eval harness that had
// never called the AI, document reading with no key configured, and a migration
// sitting unapplied while writes silently dropped their columns. Each looked
// like something else.
//
// So: turn every one of those into a sentence with a fix attached. This module
// takes raw FACTS (gathered by probe.ts, which does the I/O) and decides what to
// say about them. Pure on purpose — the judgement is what needs testing, and the
// database reads are not where the bugs live.

export type Level = "ok" | "warn" | "fail";

export type Finding = {
  id: string;
  level: Level;
  // What is true, in the founder's language. No jargon, no field names.
  summary: string;
  // What to DO. Omitted when level is "ok" — a passing check needs no action.
  action?: string;
};

// ── Facts the probe gathers ──────────────────────────────────────────────────

export type HealthFacts = {
  ai: {
    // Which provider the running process would use, and whether its key is set.
    provider: "anthropic" | "openai";
    // True when AI_CLASSIFIER_PROVIDER was set explicitly rather than defaulted.
    providerChosen: boolean;
    keyPresent: boolean;
    // Of the most recent documents that could carry a transaction, how many
    // actually produced one. null when there have been no uploads to judge by.
    recent: { considered: number; read: number; lastReadAt: string | null } | null;
  };
  // Columns a shipped feature depends on, and whether the database has them.
  // Absent = the migration has not been run, and the feature silently no-ops.
  migrations: Array<{ file: string; feature: string; applied: boolean }>;
  // One entry per client with a bookkeeping connection.
  connections: Array<{
    clientName: string;
    provider: "quickbooks" | "xero";
    // When the reference lists (accounts, suppliers, tax codes) last synced.
    lastSyncedAt: string | null;
    // Whether we know the books' currency — without it a foreign-currency
    // document cannot be posted correctly.
    booksCurrencyKnown: boolean;
  }>;
  jobs: { failedRecently: number; oldestPendingMinutes: number | null };
  // Evaluated once by the caller so the whole report is consistent.
  now: number;
};

// A cache older than this is stale enough that a newly-created supplier or
// account in the client's books is probably missing from Vylan's pickers.
const STALE_SYNC_DAYS = 7;
// A job still pending after this long is stuck, not busy.
const STUCK_JOB_MINUTES = 60;
// Below this share of recent documents being read, something is wrong beyond
// the occasional unreadable photo.
const READ_RATE_FLOOR = 0.5;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now - t) / 86_400_000;
}

function ago(iso: string | null, now: number): string {
  const d = daysSince(iso, now);
  if (d == null) return "never";
  if (d < 1 / 24) return "in the last hour";
  if (d < 1) return `${Math.round(d * 24)} hours ago`;
  return `${Math.round(d)} days ago`;
}

// ── The judgement ────────────────────────────────────────────────────────────

export function assessHealth(f: HealthFacts): Finding[] {
  const out: Finding[] = [];
  const provider = f.ai.provider === "openai" ? "OpenAI" : "Claude";

  // 1. Can documents be read at all?
  if (!f.ai.keyPresent) {
    out.push({
      id: "ai-key",
      level: "fail",
      summary: `Document reading is switched off. Vylan is set to use ${provider}, but no ${provider} key is configured — uploads will never turn into drafts.`,
      action: `Add the ${provider} API key to your hosting environment variables, then upload a document to confirm a draft appears.`,
    });
  } else if (!f.ai.providerChosen) {
    // Silent default: the running process picked Anthropic because nothing said
    // otherwise. Harmless if intended, and very confusing if not.
    out.push({
      id: "ai-provider-default",
      level: "warn",
      summary:
        "No AI provider is explicitly set, so Vylan defaulted to Claude. If you meant to use OpenAI, documents are being read by the wrong model.",
      action:
        "Set AI_CLASSIFIER_PROVIDER to openai or anthropic in your environment so it is deliberate rather than a default.",
    });
  }

  // 2. Is it actually working? A key can be present and the balance empty — the
  //    only honest evidence is whether recent documents produced anything.
  const r = f.ai.recent;
  if (f.ai.keyPresent && r && r.considered > 0) {
    const rate = r.read / r.considered;
    if (r.read === 0) {
      out.push({
        id: "ai-reads",
        level: "fail",
        summary: `None of the last ${r.considered} documents were read. Uploads are arriving but no drafts are being created.`,
        action: `Check that your ${provider} account has credit remaining, then re-upload one document to test.`,
      });
    } else if (rate < READ_RATE_FLOOR) {
      out.push({
        id: "ai-reads",
        level: "warn",
        summary: `Only ${r.read} of the last ${r.considered} documents were read (last one ${ago(r.lastReadAt, f.now)}).`,
        action:
          "Open the recent uploads and check whether they are genuinely unreadable — blurred photos and password-protected PDFs count. If they look fine, something is wrong.",
      });
    } else {
      out.push({
        id: "ai-reads",
        level: "ok",
        summary: `Documents are being read — ${r.read} of the last ${r.considered}, most recently ${ago(r.lastReadAt, f.now)}.`,
      });
    }
  }

  // 3. Migrations. The quietest failure of all: the feature ships, the column is
  //    missing, and every write drops it without a word.
  const pending = f.migrations.filter((m) => !m.applied);
  if (pending.length > 0) {
    out.push({
      id: "migrations",
      level: "fail",
      summary:
        pending.length === 1
          ? `A database update has not been applied, so ${pending[0]!.feature} is not working.`
          : `${pending.length} database updates have not been applied, so these are not working: ${pending.map((m) => m.feature).join(", ")}.`,
      action: `Open your Supabase SQL editor and run: ${pending.map((m) => m.file).join(", ")}.`,
    });
  } else if (f.migrations.length > 0) {
    out.push({
      id: "migrations",
      level: "ok",
      summary: "All database updates have been applied.",
    });
  }

  // 4. Connections: connected is not the same as usable.
  for (const c of f.connections) {
    const name = c.provider === "xero" ? "Xero" : "QuickBooks";
    const days = daysSince(c.lastSyncedAt, f.now);
    if (days == null) {
      out.push({
        id: `sync-${c.clientName}`,
        level: "fail",
        summary: `${c.clientName} is connected to ${name}, but its accounts and suppliers have never loaded — so nothing will match.`,
        action: `Open ${c.clientName} and reconnect ${name}.`,
      });
    } else if (days > STALE_SYNC_DAYS) {
      out.push({
        id: `sync-${c.clientName}`,
        level: "warn",
        summary: `${c.clientName}'s ${name} lists last updated ${ago(c.lastSyncedAt, f.now)}. Anything added in ${name} since then is invisible to Vylan.`,
        action: `Open ${c.clientName} and reconnect ${name} to refresh them.`,
      });
    }
    if (!c.booksCurrencyKnown) {
      out.push({
        id: `currency-${c.clientName}`,
        level: "warn",
        summary: `Vylan does not know what currency ${c.clientName}'s books are kept in, so a receipt in another currency cannot be recorded correctly.`,
        action: `Reconnect ${name} for ${c.clientName} — it records the currency automatically.`,
      });
    }
  }

  // 5. Background work.
  if (f.jobs.failedRecently > 0) {
    out.push({
      id: "jobs-failed",
      level: "warn",
      summary: `${f.jobs.failedRecently} background ${f.jobs.failedRecently === 1 ? "task" : "tasks"} failed recently — things like refreshing your bookkeeping lists.`,
      action: "Usually self-correcting. If this number keeps growing, tell Claude.",
    });
  }
  if (
    f.jobs.oldestPendingMinutes != null &&
    f.jobs.oldestPendingMinutes > STUCK_JOB_MINUTES
  ) {
    out.push({
      id: "jobs-stuck",
      level: "warn",
      summary: `A background task has been waiting ${Math.round(f.jobs.oldestPendingMinutes / 60)} hours to run.`,
      action: "Tell Claude — the scheduled runner may have stopped.",
    });
  }

  return out;
}

// The single headline, so the page can answer the question in one glance.
export function overallLevel(findings: Finding[]): Level {
  if (findings.some((f) => f.level === "fail")) return "fail";
  if (findings.some((f) => f.level === "warn")) return "warn";
  return "ok";
}
