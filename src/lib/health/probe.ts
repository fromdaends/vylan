// "Is anything silently not working?" — the I/O half.
//
// Gathers the facts assessHealth() judges. Every probe is READ-ONLY and every
// one fails soft: a probe that cannot answer contributes nothing rather than
// breaking the page, because a diagnostics screen that itself errors is worse
// than useless.
//
// Service role throughout — several of these read connection rows and job rows
// that RLS deliberately keeps from the browser. The PAGE is owner-gated; this
// module must only ever be called from there.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai/classify";
import type { HealthFacts } from "./verdict";

// Columns a shipped feature depends on. Each names the migration that adds it
// and, in the founder's words, what stops working without it.
//
// Probed by asking for the column and seeing whether PostgREST rejects it —
// cheaper and more honest than tracking a migrations table Vylan does not have.
const REQUIRED_COLUMNS: Array<{
  table: string;
  column: string;
  file: string;
  feature: string;
}> = [
  {
    table: "quickbooks_transaction_suggestions",
    column: "posted_provider",
    file: "1040_posted_provider.sql",
    feature: "sending a posted document to the right accounting product",
  },
  {
    table: "quickbooks_tax_codes",
    column: "can_apply_to_revenue",
    file: "1050_quickbooks_tax_direction.sql",
    feature: "suggesting a sales tax rate on sales and a purchase rate on purchases",
  },
  {
    table: "quickbooks_connections",
    column: "home_currency",
    file: "1060_quickbooks_currency_prefs.sql",
    feature: "knowing what currency a QuickBooks client's books are kept in",
  },
  {
    table: "xero_connections",
    column: "base_currency",
    file: "1030_xero_base_currency.sql",
    feature: "knowing what currency a Xero client's books are kept in",
  },
];

// How many recent documents to judge extraction by. Enough to be meaningful,
// small enough to stay one cheap query.
const RECENT_WINDOW = 20;

// Only these can carry a transaction; a signed engagement letter that produced
// no draft is not a fault.
const TXN_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/heic"];

type Sb = ReturnType<typeof getServiceRoleSupabase>;

async function probeColumns(sb: Sb): Promise<HealthFacts["migrations"]> {
  return Promise.all(
    REQUIRED_COLUMNS.map(async (c) => {
      try {
        const { error } = await sb.from(c.table).select(c.column).limit(1);
        // Any error other than "no such column" (42703 / PGRST204) is not
        // evidence the migration is missing — treat it as applied rather than
        // send the founder chasing SQL they have already run.
        const missing =
          !!error &&
          (error.code === "42703" ||
            error.code === "PGRST204" ||
            /column .* does not exist/i.test(error.message ?? ""));
        return { file: c.file, feature: c.feature, applied: !missing };
      } catch {
        return { file: c.file, feature: c.feature, applied: true };
      }
    }),
  );
}

async function probeRecentReads(
  sb: Sb,
  firmId: string,
): Promise<HealthFacts["ai"]["recent"]> {
  try {
    // Engagements first: uploaded_files has no firm_id of its own.
    const { data: engs } = await sb
      .from("engagements")
      .select("id")
      .eq("firm_id", firmId)
      .limit(500);
    const ids = (engs ?? []).map((e) => (e as { id: string }).id);
    if (ids.length === 0) return null;

    const { data, error } = await sb
      .from("uploaded_files")
      .select("mime_type, ai_extracted_fields, uploaded_at")
      .in("engagement_id", ids)
      .in("mime_type", TXN_MIMES)
      .order("uploaded_at", { ascending: false })
      .limit(RECENT_WINDOW);
    if (error || !data || data.length === 0) return null;

    let read = 0;
    let lastReadAt: string | null = null;
    for (const row of data as Array<{
      ai_extracted_fields: { transaction?: unknown } | null;
      uploaded_at: string;
    }>) {
      if (row.ai_extracted_fields?.transaction) {
        read++;
        if (!lastReadAt) lastReadAt = row.uploaded_at;
      }
    }
    return { considered: data.length, read, lastReadAt };
  } catch {
    return null;
  }
}

async function probeConnections(
  sb: Sb,
  firmId: string,
): Promise<HealthFacts["connections"]> {
  const out: HealthFacts["connections"] = [];
  // Client names, so a finding can say "ABC Inc" rather than a uuid.
  const names = new Map<string, string>();
  try {
    const { data } = await sb
      .from("clients")
      .select("id, display_name")
      .eq("firm_id", firmId);
    for (const c of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      names.set(c.id, c.display_name?.trim() || "A client");
    }
  } catch {
    /* names are cosmetic — carry on without them */
  }

  // One provider's connections, asking for the currency column and retrying
  // without it when that migration has not been run.
  //
  // The retry is the point. supabase-js returns a missing column as an ERROR
  // OBJECT rather than throwing, so the first version of this simply produced no
  // rows — every QuickBooks connection disappeared from the report the moment
  // 1060 was outstanding. A health check that hides a connection because of the
  // very thing it is meant to report is worse than not having one.
  const readConnections = async (
    table: string,
    currencyColumn: string,
    provider: "xero" | "quickbooks",
  ) => {
    const base = "client_id, last_synced_at";
    let rows: Array<Record<string, unknown>> | null = null;
    let currencyKnown = true;
    const rich = await sb
      .from(table)
      .select(`${base}, ${currencyColumn}`)
      .eq("firm_id", firmId);
    if (rich.error) {
      const basic = await sb.from(table).select(base).eq("firm_id", firmId);
      if (basic.error) return; // genuinely not connected / table absent
      rows = basic.data as unknown as Array<Record<string, unknown>> | null;
      // The column does not exist yet, so the currency cannot be known.
      currencyKnown = false;
    } else {
      rows = rich.data as unknown as Array<Record<string, unknown>> | null;
    }
    for (const r of rows ?? []) {
      out.push({
        clientName: names.get(String(r.client_id ?? "")) ?? "A client",
        provider,
        lastSyncedAt: (r.last_synced_at as string | null) ?? null,
        booksCurrencyKnown: currencyKnown && !!r[currencyColumn],
      });
    }
  };

  await readConnections("xero_connections", "base_currency", "xero");
  await readConnections("quickbooks_connections", "home_currency", "quickbooks");

  return out;
}

async function probeJobs(sb: Sb, firmId: string, now: number): Promise<HealthFacts["jobs"]> {
  const none = { failedRecently: 0, oldestPendingMinutes: null };
  try {
    // Scoped by the firm id every enqueue puts in the payload, so one firm's
    // owner never sees another firm's queue.
    const { data, error } = await sb
      .from("jobs")
      .select("status, created_at")
      .eq("payload->>firmId", firmId)
      .in("status", ["pending", "failed"])
      .gte("created_at", new Date(now - 7 * 86_400_000).toISOString())
      .limit(200);
    if (error || !data) return none;
    let failed = 0;
    let oldestPending: number | null = null;
    for (const r of data as Array<{ status: string; created_at: string }>) {
      if (r.status === "failed") failed++;
      if (r.status === "pending") {
        const mins = (now - new Date(r.created_at).getTime()) / 60_000;
        if (Number.isFinite(mins) && (oldestPending == null || mins > oldestPending)) {
          oldestPending = mins;
        }
      }
    }
    return { failedRecently: failed, oldestPendingMinutes: oldestPending };
  } catch {
    return none;
  }
}

export async function gatherHealthFacts(firmId: string): Promise<HealthFacts> {
  const sb = getServiceRoleSupabase();
  const now = Date.now();
  const provider = getProvider();
  const [migrations, recent, connections, jobs] = await Promise.all([
    probeColumns(sb),
    probeRecentReads(sb, firmId),
    probeConnections(sb, firmId),
    probeJobs(sb, firmId, now),
  ]);
  return {
    ai: {
      provider,
      // Whether the provider was CHOSEN or fell through to the default. The
      // difference is the whole point of the warning.
      providerChosen: !!process.env.AI_CLASSIFIER_PROVIDER?.trim(),
      keyPresent:
        provider === "openai"
          ? !!process.env.OPENAI_API_KEY?.trim()
          : !!process.env.ANTHROPIC_API_KEY?.trim(),
      recent,
    },
    migrations,
    connections,
    jobs,
    now,
  };
}
