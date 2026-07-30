// @vitest-environment node
//
// Ask the connected QuickBooks company what is actually in it. A read-only
// window for when Vylan's record and the books disagree.

import { describe, it } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/quickbooks/connection";

describe("QuickBooks company", () => {
  it("shows what is really there", async () => {
    const sb = getServiceRoleSupabase();
    const { data: conn } = await sb
      .from("quickbooks_connections")
      .select("firm_id, client_id, realm_id, environment")
      .limit(1)
      .single();
    const token = await getValidAccessToken(
      conn!.firm_id as string,
      conn!.client_id as string,
    );
    if (!token) throw new Error("no access token");

    // Which host does the APP use? If Vylan posts to one and we read from the
    // other, everything looks like a phantom.
    console.log("\nconnection says environment =", conn!.environment,
      "| QBO_ENVIRONMENT env =", process.env.QBO_ENVIRONMENT ?? "(unset)");

    for (const host of [
      "sandbox-quickbooks.api.intuit.com",
    ]) {
      for (const q of [
        "select Id, TxnDate, TotalAmt, DocNumber from Bill orderby Id desc maxresults 6",
        "select * from Attachable orderby Id desc maxresults 6",
      ]) {
        try {
          const r = await fetch(
            `https://${host}/v3/company/${conn!.realm_id}/query?query=${encodeURIComponent(q)}&minorversion=75`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
          );
          const t = await r.text();
          const kind = q.includes("from Bill") ? "Bill" : "Attachable";
          if (!r.ok) {
            console.log(`${host} ${kind}: HTTP ${r.status} ${t.slice(0, 120)}`);
            continue;
          }
          const rows = JSON.parse(t).QueryResponse?.[kind] ?? [];
          console.log(
            `${host} ${kind}:`,
            rows.map((x: Record<string, unknown>) => kind === "Bill"
              ? `#${x.Id}=${x.TotalAmt}${x.DocNumber ? `/${x.DocNumber}` : ""}@${x.TxnDate}`
              : `#${x.Id} "${x.FileName ?? x.Note}" -> ${JSON.stringify((x.AttachableRef as unknown[])?.map((r) => (r as {EntityRef?:{type?:string;value?:string}}).EntityRef) ?? [])}`,
            ).join("\n     ") || "(none)",
          );
        } catch (e) {
          console.log(host, "threw", (e as Error).message.slice(0, 100));
        }
      }
    }
  }, 120_000);
});
