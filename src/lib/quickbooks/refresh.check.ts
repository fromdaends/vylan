// @vitest-environment node
//
// Ask the deployed app to refresh the QuickBooks token on our behalf.
//
// Token refresh needs QBO_CLIENT_ID / QBO_CLIENT_SECRET, which live only in the
// hosting environment — so a local run can only talk to QuickBooks inside the
// hour after the last refresh. Rather than copy secrets down, enqueue the app's
// OWN sync job and let the deployment's cron run it: it refreshes and persists
// the rotated tokens, and the local process then reads a fresh one from the
// database like any other reader.
//
// Nothing bespoke — this is the same job the app enqueues after a reconnect.

import { describe, it, expect } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/db/jobs";

describe("QuickBooks token", () => {
  it("enqueues a sync so the deployment refreshes it", async () => {
    const sb = getServiceRoleSupabase();
    const { data: conn } = await sb
      .from("quickbooks_connections")
      .select("firm_id, client_id, access_token_expires_at")
      .limit(1)
      .single();
    console.log(
      "\nbefore: token expires",
      conn!.access_token_expires_at,
      `(${Math.round(
        (new Date(conn!.access_token_expires_at as string).getTime() - Date.now()) / 60000,
      )} min)`,
    );
    await enqueueJob({
      kind: "sync_quickbooks",
      payload: { firmId: conn!.firm_id, clientId: conn!.client_id },
      runAfter: new Date(Date.now() - 1000),
    });
    console.log("enqueued sync_quickbooks");
    expect(conn).toBeTruthy();
  }, 60_000);
});
