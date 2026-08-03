import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { CLIENT_BOOKKEEPING_VIEWS } from "./tabs";

// The client page's Bookkeeping tab renders the firm-wide bookkeeping
// components, so it reads their strings out of the Quickbooks namespace rather
// than inventing a second set of words for "Missing receipts".
//
// THIS TEST EXISTS BECAUSE A WRONG next-intl KEY IS INVISIBLE. It does not
// throw, it does not fail tsc, eslint or next build — it renders the key
// itself as visible text on the page ("Quickbooks.gaps_title"), and the only
// way to catch it is to open the screen or to check the message files. That
// has now shipped twice in this repo (#1176/#1177), which is what this guards.
const KEYS_THE_TAB_READS = [
  // The two panels.
  "close_title",
  "bk_logs_title",
  // The sub-tab labels, one per view in CLIENT_BOOKKEEPING_VIEWS.
  "gaps_title",
  "uncat_title",
  // What a Xero client sees where the two QuickBooks-only lists would be. It
  // must say "we cannot look here yet" — never render an empty list, which
  // would read as "nothing outstanding".
  "close_ledger_xero_pending",
] as const;

describe("the client Bookkeeping tab's copy", () => {
  it("has an English and a French string for every key it reads", () => {
    const enQb = (en as Record<string, Record<string, string>>).Quickbooks;
    const frQb = (fr as Record<string, Record<string, string>>).Quickbooks;
    for (const key of KEYS_THE_TAB_READS) {
      expect(enQb[key], `en Quickbooks.${key}`).toBeTruthy();
      expect(frQb[key], `fr Quickbooks.${key}`).toBeTruthy();
    }
  });

  it("has no dot in any key — next-intl splits on it and walks a namespace", () => {
    // A key containing a dot resolves as Namespace → part → part, misses, and
    // prints itself on screen. Exactly how `cap_team.manage` shipped.
    for (const key of KEYS_THE_TAB_READS) expect(key).not.toContain(".");
  });

  it("labels every sub-tab the tab can show", () => {
    // Add a view to CLIENT_BOOKKEEPING_VIEWS without a label and this fails,
    // rather than an accountant meeting a raw key.
    const labelFor: Record<string, string> = {
      receipts: "gaps_title",
      uncategorized: "uncat_title",
    };
    for (const view of CLIENT_BOOKKEEPING_VIEWS) {
      expect(labelFor[view], `no label key for the "${view}" list`).toBeTruthy();
      expect(KEYS_THE_TAB_READS).toContain(
        labelFor[view] as (typeof KEYS_THE_TAB_READS)[number],
      );
    }
  });
});
