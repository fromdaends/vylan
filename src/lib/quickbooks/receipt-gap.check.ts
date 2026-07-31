// @vitest-environment node
//
//   npm run qbo:gaps
//
// Run the receipt scan against the connected company and print what it finds.
//
// This exists because the feature's whole premise is a number nobody knew: if a
// real set of books has four unsupported expenses, chasing them is not a
// product. If it has forty, it is. Read-only — it queries and prints, and writes
// nothing anywhere.

import { describe, it, expect } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { scanReceiptGaps, describeGapForClient } from "./receipt-gap";

const FROM = process.env.QBO_GAPS_FROM ?? "2024-01-01";
const TO = process.env.QBO_GAPS_TO ?? "2026-12-31";

describe("receipt gaps in the connected company", () => {
  it(
    "finds the posted expenses with nothing attached",
    async () => {
      const sb = getServiceRoleSupabase();
      const { data: conn } = await sb
        .from("quickbooks_connections")
        .select("firm_id, client_id, company_name")
        .limit(1)
        .single();
      expect(conn, "no QuickBooks connection to scan").toBeTruthy();

      const ctx = await getQuickbooksReadContext(
        conn!.firm_id as string,
        conn!.client_id as string,
      );
      if (!ctx) throw new Error("no access token — run `npm run qbo:refresh`");

      const scan = await scanReceiptGaps(ctx, { from: FROM, to: TO });
      console.log(
        `\n${conn!.company_name} — ${FROM} to ${TO}`,
        `\n${scan.gaps.length} of ${scan.considered} posted expenses have no receipt attached` +
          (scan.truncated ? "  ⚠ read was truncated, there may be more" : ""),
        "\n",
      );
      for (const g of scan.gaps.slice(0, 25)) {
        console.log(
          "  ",
          `${g.entity}#${g.qboId}`.padEnd(14),
          describeGapForClient(g).padEnd(46),
          g.accountName ?? "(uncoded)",
        );
      }
      if (scan.gaps.length > 25) {
        console.log(`   … and ${scan.gaps.length - 25} more`);
      }
      // No assertion on the count — the number IS the finding.
      expect(scan.considered).toBeGreaterThanOrEqual(0);
    },
    120_000,
  );
});
