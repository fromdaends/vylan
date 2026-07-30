// @vitest-environment node
//
//   npm run health
//
// The command-line twin of /settings/health. Exits 0 when everything checks out
// and NON-ZERO when something is broken, so it is usable unattended — and so
// whoever is fixing Vylan (or Claude, mid-task) can read the state of the system
// without holding a browser session the owner-gated page requires.
//
// Read-only: it probes, it never repairs. A `warn` does not fail the run —
// warnings are things worth a look, not things that are wrong, and a check that
// cries wolf gets ignored.

import { describe, it, expect } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { gatherHealthFacts } from "./probe";
import { assessHealth, overallLevel } from "./verdict";
import { formatHealthReport } from "./report";

describe("system check", () => {
  it(
    "reports every firm, and fails only on something actually broken",
    async () => {
      const sb = getServiceRoleSupabase();
      const { data, error } = await sb.from("firms").select("id, name");
      if (error) throw new Error(`could not list firms: ${error.message}`);
      const firms = (data ?? []) as Array<{ id: string; name: string | null }>;
      if (firms.length === 0) {
        console.log("\nNo firms in this database — nothing to check.\n");
        return;
      }

      const broken: string[] = [];
      let printedGlobal = false;
      for (const firm of firms) {
        const findings = assessHealth(await gatherHealthFacts(firm.id));

        // Whole-installation findings — a missing API key, an unapplied
        // migration — are identical for every firm. Printed once, or the one
        // finding that is actually about a client drowns in repeats.
        if (!printedGlobal) {
          const global = findings.filter((f) => f.scope === "global");
          if (global.length > 0) {
            console.log(formatHealthReport(global, { firmName: "everything" }));
          }
          printedGlobal = true;
        }

        const mine = findings.filter((f) => f.scope === "firm");
        // Silence is the goal: a firm with nothing to say should say nothing, so
        // the ones that do stand out.
        if (mine.some((f) => f.level !== "ok")) {
          console.log(formatHealthReport(mine, { firmName: firm.name }));
        }
        if (overallLevel(findings) === "fail") {
          broken.push(
            `${firm.name ?? firm.id}: ` +
              findings
                .filter((f) => f.level === "fail")
                .map((f) => f.summary)
                .join(" | "),
          );
        }
      }
      console.log(
        broken.length === 0
          ? `\nChecked ${firms.length} firm${firms.length === 1 ? "" : "s"} — nothing broken.\n`
          : `\nChecked ${firms.length} firms — ${broken.length} with something broken.\n`,
      );

      // Warnings are deliberately not failures. Only a genuine breakage — no way
      // to read documents, an unapplied migration, a connection that can never
      // match — stops the run.
      expect(broken, "something is broken").toEqual([]);
    },
    120_000,
  );
});
