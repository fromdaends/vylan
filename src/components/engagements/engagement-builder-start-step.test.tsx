import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// THE OPENING QUESTION IS THE WIZARD'S FIRST STEP.
//
// Founder, with two screenshots side by side: "have this tab and the other be
// the same thing instead of two separate steps, they transition into one
// another, just have the create from template or start from scratch be in the
// same card as creating an engagement. So it doesn't look weird."
//
// It used to be a bare dialog with a lone Next button, which then vanished and
// was replaced by the three-column wizard — two different objects for one
// continuous act. What follows pins the parts of "one card" that a screenshot
// would show: the rail is there while the question is asked, the question is
// step 1 of the same run, there is only one button that moves you forward, and
// pressing it lands on Engagement details rather than opening something new.

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

describe("Starting an engagement is one card, not two", () => {
  it("asks the question inside the wizard — the steps rail is already there", () => {
    mountFresh();
    expect(screen.getByText(en.Engagements.start_title)).toBeTruthy();
    // The rail the OLD chooser dialog did not have. Its presence is the whole
    // difference the founder was pointing at.
    // getAllBy: the active step's name is drawn twice on purpose — once in the
    // rail and once as the heading over the content.
    expect(
      screen.getAllByText(en.Engagements.wizard_step_start).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(en.Engagements.wizard_step_details).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(en.Engagements.wizard_step_proposal).length,
    ).toBeGreaterThan(0);
  });

  it("counts the question as step 1 of the same run, not a prologue to it", () => {
    mountFresh();
    // 6 wizard steps with workflows on (reminders folds into automation), plus
    // the question itself = 7. The point is that it is numbered WITH them.
    expect(
      screen.getByText(en.Templates.step_of.replace("{n}", "1").replace("{total}", "7")),
    ).toBeTruthy();
  });

  it("offers exactly one way forward — the wizard's own Continue", () => {
    mountFresh();
    // The chooser's private Next is gone. Two primary buttons in one card,
    // inches apart, is what "it looks weird" was describing.
    expect(screen.queryByText(en.Engagements.start_next)).toBeNull();
    expect(continueButton()).toBeTruthy();
  });

  it("transitions into the details step rather than opening something new", () => {
    mountFresh();
    expect(screen.queryByText(en.Engagements.field_title)).toBeNull();
    fireEvent.click(continueButton()!);
    // Same card, next step: the details form is now here and the question is
    // not.
    expect(screen.getByText(en.Engagements.field_title)).toBeTruthy();
    expect(screen.queryByText(en.Engagements.start_title)).toBeNull();
  });

  it("walks back into the question, and Continue does not re-apply the same answer", () => {
    mountFresh();
    fireEvent.click(continueButton()!);
    const title = screen.getByLabelText(
      en.Engagements.field_title,
    ) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Typed by hand" } });

    const back = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim() === en.Templates.back);
    fireEvent.click(back!);
    expect(screen.getByText(en.Engagements.start_title)).toBeTruthy();

    // Forward again with the answer unchanged. Re-applying the template here
    // would silently overwrite what was typed — the reason the commit is
    // guarded rather than unconditional.
    fireEvent.click(continueButton()!);
    expect(
      (screen.getByLabelText(en.Engagements.field_title) as HTMLInputElement)
        .value,
    ).toBe("Typed by hand");
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
    // Asked and answered before the builder opened, so the rail must not grow
    // a step nobody used.
    expect(screen.queryByText(en.Engagements.start_title)).toBeNull();
    expect(screen.queryAllByText(en.Engagements.wizard_step_start)).toHaveLength(
      0,
    );
    expect(screen.getByText(en.Engagements.field_title)).toBeTruthy();
  });
});
