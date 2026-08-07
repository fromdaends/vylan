import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// THE CADENCE CARD, ACTUALLY RENDERED.
//
// The founder has caught four wrong versions of this control in a row, each
// time from a screenshot, because the browser preview cannot be driven from
// here (the local session is signed out). So the shape they asked for gets a
// test instead of a promise:
//
//   "have it in one little button so you could select doesn't repeat if you
//    don't want anything repeating. Then... you click on recurring, and it
//    shows billing... it shows the entire work job option."
//
// One on/off at the top; both knobs revealed together underneath, never a
// list of three sibling modes.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/engagements/new",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...rest }: React.ComponentProps<"a">) => (
    <a {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions/engagements", () => ({
  createEngagementAction: vi.fn(),
}));
vi.mock("@/app/actions/engagement-templates", () => ({
  saveEngagementTemplateAction: vi.fn(),
}));
vi.mock("@/app/actions/signatures", () => ({
  finalizeSignaturePlacementAction: vi.fn(),
}));
vi.mock("@/app/actions/firm-terms", () => ({
  saveFirmDefaultTermsAction: vi.fn(),
}));

const { EngagementBuilder } = await import("./engagement-builder");
const { emptyPayload } = await import("@/lib/engagements/template-payload");

// A seeded engagement template is the ONE thing that skips the start chooser,
// so the wizard renders directly.
const ENGAGEMENT_TEMPLATE = {
  id: "et-1",
  name: "Corporate return",
  access: "team" as const,
  // The real factory, so the fixture can never drift from the shape the
  // builder reads (a hand-rolled one was already missing termsSections).
  payload: { ...emptyPayload(), title: "Corporate return" },
};

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementBuilder
        clients={[]}
        templates={[]}
        locale="en"
        workflowsOn
        engagementTemplates={[ENGAGEMENT_TEMPLATE]}
        initialEngagementTemplateId="et-1"
      />
    </NextIntlClientProvider>,
  );
}

/** Walk the wizard forward to the Automation step.
 *
 *  The steps rail only lets you jump to steps you have already VISITED
 *  (disabled={!reachable}), so a fresh mount has to press Continue its way
 *  there — which is what a person does too. */
function goToAutomation() {
  for (let i = 0; i < 6; i++) {
    if (screen.queryByText(en.Engagements.cadence_card_title)) return;
    const next = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim() === en.Templates.continue_step);
    if (!next) break;
    fireEvent.click(next);
  }
  if (!screen.queryByText(en.Engagements.cadence_card_title)) {
    throw new Error("never reached the Automation step");
  }
}

/** The card's on/off select: a combobox labelled by the card title. */
function repeatsSelect() {
  return screen.getByRole("combobox", {
    name: en.Engagements.cadence_card_title,
  });
}

afterEach(cleanup);

describe("How this repeats — one on/off, then the details", () => {
  it("starts closed: no pay or work frequency anywhere on the step", () => {
    mount();
    goToAutomation();
    expect(screen.getByText(en.Engagements.cadence_card_title)).toBeTruthy();
    // The two knobs are NOT rendered while nothing repeats.
    expect(screen.queryByText(en.Engagements.cadence_pay_label)).toBeNull();
    expect(screen.queryByText(en.Engagements.cadence_work_label)).toBeNull();
    // It says what "doesn't repeat" means instead of showing dead controls.
    expect(screen.getByText(en.Engagements.cadence_none_hint)).toBeTruthy();
  });

  it("choosing Recurring reveals BOTH the billing and the work option", () => {
    mount();
    goToAutomation();
    // The card's own select — labelled by the card title.
    fireEvent.click(repeatsSelect());
    fireEvent.click(screen.getByText(en.Engagements.cadence_recurring));

    expect(screen.getByText(en.Engagements.cadence_pay_label)).toBeTruthy();
    expect(screen.getByText(en.Engagements.cadence_work_label)).toBeTruthy();
    expect(screen.queryByText(en.Engagements.cadence_none_hint)).toBeNull();
  });

  it("the three sibling modes are gone — 'Bills repeatedly' is not an option", () => {
    mount();
    goToAutomation();
    fireEvent.click(repeatsSelect());
    // Only two answers to "does this repeat". (getAllByText: the selected
    // value renders on the trigger AND in the open list.)
    expect(
      screen.getAllByText(en.Engagements.cadence_none).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(en.Engagements.cadence_recurring).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Bills repeatedly")).toBeNull();
    expect(screen.queryByText("Recreates the whole job")).toBeNull();
  });
});
