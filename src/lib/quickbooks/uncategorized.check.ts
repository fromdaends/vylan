// @vitest-environment node
//
//   npx vitest run --config vitest.check.config.ts src/lib/quickbooks/uncategorized.check.ts
//
// Run the uncategorised scan against the connected company and print what it
// finds. Read-only — it queries and prints, and writes nothing anywhere.
//
// Same reason its sibling (receipt-gap.check.ts) exists: the premise of the
// feature is a number nobody knew. If a real set of books has two uncoded
// entries, a screen for them is not a product. If it has eighty, it is. And the
// second thing it prints matters as much as the first — WHICH accounts were
// treated as parking accounts. That is the assumption the whole scan rests on,
// and it is the one most likely to be wrong in a company file we have not seen.

import { describe, it, expect } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import {
  readAccounts,
  scanUncategorized,
  uncategorizedAmong,
  describeUncatForClient,
} from "./uncategorized";

const FROM = process.env.QBO_UNCAT_FROM ?? "2024-01-01";
const TO = process.env.QBO_UNCAT_TO ?? "2026-12-31";

describe("uncategorised transactions in the connected company", () => {
  it(
    "finds what nobody has coded, and says which accounts it counted",
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

      const accounts = await readAccounts(ctx);
      const parking = uncategorizedAmong(accounts);
      console.log(
        `\n${conn!.company_name} — ${FROM} to ${TO}`,
        `\n${accounts.length} accounts in the chart; ${parking.length} of them read as "not coded yet":`,
        parking.length
          ? `\n   ${parking.map((a) => `${a.name} (#${a.id})`).join("\n   ")}`
          : "\n   (none — nothing can be parked in this company)",
        "\n",
      );

      const scan = await scanUncategorized(ctx, { from: FROM, to: TO, accounts });
      console.log(
        `${scan.txns.length} of ${scan.considered} posted transactions have a line with no category` +
          (scan.truncated ? "  ⚠ read was truncated, there may be more" : ""),
        "\n",
      );
      for (const t of scan.txns.slice(0, 25)) {
        console.log(
          "  ",
          `${t.entity}#${t.qboId}`.padEnd(14),
          describeUncatForClient(t).padEnd(52),
          `→ ${t.accountName ?? "?"}`,
        );
      }
      if (scan.txns.length > 25) {
        console.log(`   … and ${scan.txns.length - 25} more`);
      }
      // No assertion on the count — the number IS the finding.
      expect(scan.considered).toBeGreaterThanOrEqual(0);
    },
    120_000,
  );
});
