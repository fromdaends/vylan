import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// The items editor reaches the locale-aware router, which cannot resolve
// under vitest. Nothing here tests the item rows themselves — the question is
// which BLOCK-level controls render — so a marker stands in for them.
vi.mock("@/components/engagements/engagement-items-editor", () => ({
  EngagementItemsEditor: () => <div data-testid="items-editor" />,
}));

import { BillingBlocksEditor } from "./billing-blocks-editor";
import {
  BLOCK_FREQUENCIES,
  defaultPriceVisibility,
  emptyBlock,
  type BillingBlock,
} from "@/lib/engagements/billing-blocks";

function mount(blocks: BillingBlock[], hideBillingType = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BillingBlocksEditor
        blocks={blocks}
        onChange={() => {}}
        visibility={defaultPriceVisibility()}
        onVisibilityChange={() => {}}
        locale="en"
        hideBillingType={hideBillingType}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

// The founder, on recurrence living in two places: "there's now recurring
// still on service items, when you should just be able to do that from
// automation." The engagement builder passes hideBillingType; the template
// builders (which have no Automation step) must keep the full controls.
describe("BillingBlocksEditor — who owns recurrence", () => {
  it("shows the One-time / Recurring pills by default (template builders)", () => {
    mount([emptyBlock("one_time")]);
    expect(screen.getByText("One-time")).toBeTruthy();
    expect(screen.getByText("Recurring")).toBeTruthy();
  });

  it("hides the pills — and the per-block frequency — when the Automation step owns it", () => {
    mount([emptyBlock("recurring")], true);
    expect(screen.queryByText("One-time")).toBeNull();
    expect(screen.queryByText("Recurring")).toBeNull();
    // The block is still recurring; only its controls moved.
    expect(screen.queryByLabelText(en.Templates.billing_frequency)).toBeNull();
  });

  // This used to assert the OPPOSITE — "keeps the timing control either way,
  // when a charge falls due is not recurrence". That reasoning was wrong twice
  // over. The founder: "You cannot decide a time when it's paid on service
  // items. That just does not happen. It cannot happen. Only have it be in
  // billing and payments." And the control never worked: nothing ever wrote
  // billing_timing to a row, so every option was inert.
  //
  // Asserted on BOTH surfaces, because they share this component and the whole
  // point is that neither can offer the choice.
  it("offers no billing-timing control — that question belongs to Billing and payments", () => {
    mount([emptyBlock("one_time")], true);
    expect(screen.queryByText(en.Templates.billing_when)).toBeNull();
    expect(screen.queryByLabelText(en.Templates.billing_when)).toBeNull();

    cleanup();
    mount([emptyBlock("one_time")]);
    expect(screen.queryByText(en.Templates.billing_when)).toBeNull();
    expect(screen.queryByLabelText(en.Templates.billing_when)).toBeNull();
  });

  it("offers no timing OPTION either, on a recurring block", () => {
    // The options were type-dependent, so a recurring block was the other half
    // of the picker. Neither half may render.
    mount([emptyBlock("recurring")]);
    for (const label of [
      en.Templates.timing_on_acceptance,
      en.Templates.timing_on_completion,
      en.Templates.timing_engagement_start,
      en.Templates.timing_custom_date,
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

// The Automation step's "Bills repeatedly" frequency picker labels every
// BLOCK_FREQUENCIES entry through Templates.freq_*. next-intl fails SILENTLY
// on a missing key — it renders the key itself — so a new frequency added
// without its label would ship as "freq_biweekly" on the founder's screen.
describe("every billing frequency has a label in both languages", () => {
  it("covers BLOCK_FREQUENCIES with EN and FR strings", async () => {
    const fr = (await import("../../../messages/fr.json")).default;
    for (const f of BLOCK_FREQUENCIES) {
      const key = `freq_${f}` as keyof typeof en.Templates;
      expect(en.Templates[key]).toBeTruthy();
      expect(
        (fr.Templates as unknown as Record<string, string>)[key],
      ).toBeTruthy();
    }
  });
});
