// The i18n key for a grantable capability's switch label — ONE mapper.
//
// member-permissions.tsx and roles-workbench.tsx each carried their own copy
// of this as a ternary (`billing ? A : B`), which was fine at two capabilities
// and silently wrong at five: every new capability would have rendered as
// "Connect bookkeeping software" in both places. Same concept, one home — the
// cohesion rule at its smallest.
//
// Keys live in the Team namespace. A new GRANTABLE capability needs a case
// here AND the en+fr strings; the exhaustive switch makes tsc the reminder.
//
// Plain module (no "use client") so both server and client code may import it.

import type { Capability } from "./capabilities";

export function capabilityLabelKey(cap: Capability): string {
  switch (cap) {
    case "billing.manage":
      return "permissions_cap_billing";
    case "integrations.manage":
      return "permissions_cap_integrations";
    case "rates.manage":
      return "permissions_cap_rates";
    // The label carries its own warning (rendered, not a comment): Insights
    // shows margin, margin ÷ hours is a rate, so granting this IS granting
    // rates-adjacent knowledge. No switch text may imply otherwise.
    case "insights.view":
      return "permissions_cap_insights";
    case "time.manage":
      return "permissions_cap_time_manage";
    default:
      // Non-grantable capabilities never reach a switch; a stable fallback
      // beats a throw inside render.
      return "permissions_cap_integrations";
  }
}
