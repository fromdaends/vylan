// Quick links — the firm's pinned URLs on the Overview (1390).
//
// READS DEGRADE, WRITES REFUSE, the same shape as engagement-tasks.ts. Before
// 1390 there is no table: a read returns "no links", which renders the card's
// empty state, and a write names the file to run.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type FirmLink = {
  id: string;
  label: string;
  url: string;
  sort: number;
};

export class FirmLinksUnsupportedError extends Error {
  constructor() {
    super(
      "Quick links need database update 1390. Run supabase/migrations/1390_firm_links.sql and try again.",
    );
    this.name = "FirmLinksUnsupportedError";
  }
}

export async function listFirmLinks(): Promise<FirmLink[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("firm_links")
    .select("id, label, url, sort")
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  const out: FirmLink[] = [];
  for (const r of data ?? []) {
    if (
      typeof r.id === "string" &&
      typeof r.label === "string" &&
      typeof r.url === "string"
    ) {
      out.push({
        id: r.id,
        label: r.label,
        url: r.url,
        sort: typeof r.sort === "number" ? r.sort : 0,
      });
    }
  }
  return out;
}

export async function addFirmLink(input: {
  firmId: string;
  label: string;
  url: string;
  createdBy?: string | null;
}): Promise<string> {
  const supabase = await getServerSupabase();
  // Appended. Read the current tail rather than keeping a counter — links are
  // rare enough that one extra read is the cheaper correctness (the same call
  // addTaskAction makes for order_index).
  const { data: tail, error: tailErr } = await supabase
    .from("firm_links")
    .select("sort")
    .order("sort", { ascending: false })
    .limit(1);
  if (tailErr && !isMissingSchema(tailErr)) throw tailErr;
  if (tailErr) throw new FirmLinksUnsupportedError();
  const sort = ((tail?.[0]?.sort as number | undefined) ?? -10) + 10;

  const { data, error } = await supabase
    .from("firm_links")
    .insert({
      firm_id: input.firmId,
      label: input.label,
      url: input.url,
      sort,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingSchema(error)) throw new FirmLinksUnsupportedError();
    throw error;
  }
  return (data as { id: string }).id;
}

export async function deleteFirmLink(input: {
  id: string;
  firmId: string;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("firm_links")
    .delete()
    .eq("id", input.id)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new FirmLinksUnsupportedError();
    throw error;
  }
}
