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

// ── HOW THE CLIENT AGREES ──────────────────────────────────────────────────
// Founder: "you could just choose whether you wanna use the actual proposal
// ... they just click on accept, they don't have to actually esign anything.
// Or the option for the firm to upload their own engagement letter." And, on
// the letter path: "they do not see the sample client, the preview ... there's
// no point in seeing it." And: "that shouldn't even be a button" — placement
// is automatic, never asked.
describe("the agreement choice decides what the rest of the wizard shows", () => {
  function pickLetterMode() {
    fireEvent.click(screen.getByText(en.Engagements.agreement_mode_letter));
  }

  it("asks the question on step 1, defaulting to the proposal", () => {
    mount();
    expect(screen.getByText(en.Engagements.agreement_mode_title)).toBeTruthy();
    expect(
      screen.getByText(en.Engagements.agreement_mode_proposal_hint),
    ).toBeTruthy();
  });

  it("proposal mode keeps the preview and shows NO letter anywhere", () => {
    mount();
    // The preview pane renders the proposal document.
    expect(screen.getAllByText(en.Templates.doc_kicker).length).toBeGreaterThan(
      0,
    );
    goToAutomation();
    expect(
      screen.queryByText(en.Automations.action_send_engagement_letter),
    ).toBeNull();
    expect(
      screen.queryByText(en.Automations.flow_letter_place_note),
    ).toBeNull();
  });

  it("letter mode drops the proposal preview AND its step", () => {
    mount();
    // Proposal mode: the document's own headings are on screen.
    expect(
      screen.getAllByText(en.Templates.doc_acceptance_heading).length,
    ).toBeGreaterThan(0);

    pickLetterMode();
    expect(
      screen.getByText(en.Engagements.agreement_mode_letter_hint),
    ).toBeTruthy();
    // The preview is gone...
    expect(screen.queryByText(en.Templates.doc_acceptance_heading)).toBeNull();
    // ...and so is the step that composed it — nobody will read it.
    const proposalTab = screen
      .getAllByRole("button")
      .find((b) =>
        b.textContent?.includes(en.Engagements.wizard_step_proposal),
      );
    expect(proposalTab).toBeUndefined();
  });

  it("never asks about placing signature fields — it just says it happens", () => {
    mount();
    pickLetterMode();
    goToAutomation();
    // The old switch's label is gone from the product entirely.
    expect(screen.queryByText("Place the signature fields myself")).toBeNull();
  });
});
