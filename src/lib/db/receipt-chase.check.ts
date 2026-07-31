// @vitest-environment node
//
//   npm run qbo:chase-check
//
// Proves the ONE safety property this feature rests on, against the real
// database: before migration 1120 is applied, creating a receipt chase REFUSES
// rather than quietly creating items it cannot link.
//
// Why this is worth a live check rather than a unit test. Every other
// pre-migration path in the repo degrades silently — the column is missing, the
// feature does less, nothing breaks. Here that would be actively harmful: a
// chase item with no ledger reference still reaches the client, the client still
// uploads a receipt, and the receipt still posts — as a SECOND transaction for
// an expense already in the books. Silently doing less would mean silently
// overstating a client's expenses.
//
// After 1120 is applied this check flips meaning: it should then create items.
// It reports which side of that line the database is on rather than asserting a
// fixed answer, so it is useful before AND after.

import { describe, it, expect, vi } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", async (orig) => {
  const real = await orig<typeof import("@/lib/supabase/server")>();
  return { ...real, getServerSupabase: async () => real.getServiceRoleSupabase() };
});

describe("receipt chase — the fail-closed guarantee", () => {
  it("refuses to create a chase it cannot link, or confirms 1120 is applied", async () => {
    const sb = getServiceRoleSupabase();

    // Ask the database directly whether the column exists. Selecting a missing
    // column is an ERROR OBJECT from supabase-js, not a throw — the exact shape
    // that made an earlier health probe hide every QuickBooks connection.
    const { error } = await sb.from("request_items").select("ledger_txn").limit(1);
    const applied = !error;
    console.log(
      applied
        ? "\nmigration 1120 IS applied — chases can be created and will carry their transaction reference."
        : `\nmigration 1120 NOT applied yet — chases must REFUSE. (${error?.message})`,
    );

    const { createReceiptChaseItems, LedgerRefUnsupportedError } = await import(
      "./receipt-chase"
    );
    const { data: eng } = await sb
      .from("engagements")
      .select("id")
      .in("status", ["in_progress", "sent"])
      .limit(1)
      .maybeSingle();
    if (!eng) {
      console.log("no live engagement to test against — skipping the write half.");
      return;
    }

    const gap = {
      qboId: "__check__",
      entity: "bill" as const,
      txnDate: "2026-07-31",
      totalAmt: 1.23,
      currency: "CAD",
      docNumber: null,
      vendorId: null,
      vendorName: "Vylan self-check (delete me)",
      accountName: null,
    };

    if (applied) {
      // Post-migration: prove the reference is actually stored, then remove the
      // row. A check that leaves litter in a real engagement is a check nobody
      // runs twice.
      const res = await createReceiptChaseItems({
        engagementId: eng.id as string,
        gaps: [gap],
      });
      console.log("created:", res.created, "| skipped as duplicate:", res.skippedDuplicate);
      const { data: rows } = await sb
        .from("request_items")
        .select("id, ledger_txn")
        .eq("engagement_id", eng.id)
        .not("ledger_txn", "is", null);
      const mine = (rows ?? []).filter(
        (r) => (r.ledger_txn as { txnId?: string } | null)?.txnId === "__check__",
      );
      console.log("stored reference:", JSON.stringify(mine[0]?.ledger_txn));
      expect(mine.length).toBeGreaterThan(0);
      for (const r of mine) {
        await sb.from("request_items").delete().eq("id", r.id);
      }
      console.log("cleaned up", mine.length, "check row(s).");
    } else {
      // Pre-migration: the whole point.
      await expect(
        createReceiptChaseItems({
          engagementId: eng.id as string,
          gaps: [gap],
        }),
      ).rejects.toBeInstanceOf(LedgerRefUnsupportedError);
      // And it must not have written anything on the way to refusing.
      const { data: after } = await sb
        .from("request_items")
        .select("id")
        .eq("engagement_id", eng.id)
        .eq("label", `Receipt — 1.23 CAD at Vylan self-check (delete me) on July 31, 2026`);
      expect(after ?? [], "it refused but still created the item").toEqual([]);
      console.log("refused cleanly, and wrote nothing.");
    }
  }, 120_000);
});
