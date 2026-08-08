import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// THE OPENING QUESTION IS A BLANK CARD.
//
// Founder: "have the entire page be blank with no start. Because if they
// choose template there would be no steps to go through. So make the page
// blank with no client preview, then have the client preview appear when they
// select one or the other."
//
// The steps are a CONSEQUENCE of the answer, so the screen that asks the
// question shows no rail, no counter, no Back and no preview — it is the
// question and nothing else. Answering it lights the preview; Continue opens
// the wizard proper. What follows pins each of those, because they are exactly
// what a screenshot would show and the founder has now sent three.

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

const TEMPLATE = {
  id: "et-1",
  name: "Corporate return",
  access: "team" as const,
  payload: { ...emptyPayload(), title: "Corporate return" },
};

/** A fresh "New engagement" — no template preselected, so the question IS
 *  asked. That is the flow the founder screenshotted. */
function mountFresh() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementBuilder
        clients={[]}
        templates={[]}
        locale="en"
        workflowsOn
        engagementTemplates={[TEMPLATE]}
      />
    </NextIntlClientProvider>,
  );
}

function continueButton() {
  return screen
    .getAllByRole("button")
    .find((b) => b.textContent?.trim() === en.Templates.continue_step);
}

afterEach(cleanup);

/** The right-hand panel, identified by the label the shell puts on it. */
function previewPanel() {
  return screen.queryByText(en.Templates.preview_sample_label);
}

describe("The opening question is a blank card", () => {
  it("shows the question and nothing else — no rail, no counter, no Back", () => {
    mountFresh();
    expect(screen.getByText(en.Engagements.start_title)).toBeTruthy();
    // The wizard's steps are a consequence of the answer, so none of them are
    // named yet.
    expect(screen.queryByText(en.Engagements.wizard_step_details)).toBeNull();
    expect(screen.queryByText(en.Engagements.wizard_step_proposal)).toBeNull();
    expect(screen.queryByText(/^Step \d+ of \d+$/)).toBeNull();
    expect(
      screen
        .getAllByRole("button")
        .some((b) => b.textContent?.trim() === en.Templates.back),
    ).toBe(false);
  });

  it("shows no client preview until something is chosen", () => {
    mountFresh();
    expect(previewPanel()).toBeNull();
  });

  it("cannot continue while the question is unanswered", () => {
    mountFresh();
    const go = continueButton();
    expect(go).toBeTruthy();
    expect(go).toBeDisabled();
  });

  it("brings the preview in when a card is picked", () => {
    mountFresh();
    fireEvent.click(screen.getByText(en.Engagements.start_from_scratch));
    expect(previewPanel()).toBeTruthy();
    // And the way forward opens with it.
    expect(continueButton()).not.toBeDisabled();
  });

  it("picking the other card works the same way", () => {
    mountFresh();
    fireEvent.click(screen.getByText(en.Engagements.start_with_template));
    expect(previewPanel()).toBeTruthy();
    expect(continueButton()).not.toBeDisabled();
  });

  it("opens the wizard on Continue — rail and counter arrive together", () => {
    mountFresh();
    fireEvent.click(screen.getByText(en.Engagements.start_from_scratch));
    fireEvent.click(continueButton()!);

    expect(screen.queryByText(en.Engagements.start_title)).toBeNull();
    expect(screen.getByText(en.Engagements.field_title)).toBeTruthy();
    // Numbered from the first REAL step, because the question was never one.
    expect(
      screen.getByText(
        en.Templates.step_of.replace("{n}", "1").replace("{total}", "6"),
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText(en.Engagements.wizard_step_details).length,
    ).toBeGreaterThan(0);
  });

  it("fills the form from the template that was picked", () => {
    mountFresh();
    fireEvent.click(screen.getByText(en.Engagements.start_with_template));
    fireEvent.click(continueButton()!);
    expect(
      (screen.getByLabelText(en.Engagements.field_title) as HTMLInputElement)
        .value,
    ).toBe("Corporate return");
  });

  it("skips the question when a template was already chosen elsewhere", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EngagementBuilder
          clients={[]}
          templates={[]}
          locale="en"
          workflowsOn
          engagementTemplates={[TEMPLATE]}
          initialEngagementTemplateId="et-1"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(en.Engagements.start_title)).toBeNull();
    expect(screen.getByText(en.Engagements.field_title)).toBeTruthy();
  });
});
