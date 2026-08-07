import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { AutomationEditor } from "./automation-editor";
import { returnTypeWorkflow } from "@/lib/workflow/definition";
import { flowSendsLetter } from "@/lib/workflow/plan";
import type { WorkflowDefinition } from "@/lib/workflow/definition";

function mount(
  value: WorkflowDefinition,
  onChange: (next: WorkflowDefinition) => void = () => {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AutomationEditor value={value} onChange={onChange} members={[]} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

// The founder's critique, as assertions: the letter rides the SEND, so the
// editor must never offer it as a per-stage "when it starts" toggle — it is
// one flow-level switch on the "when it's sent" card, and nothing else.
describe("AutomationEditor letter placement", () => {
  it("offers the letter ONCE, on the flow-level send card — never per stage", () => {
    mount(returnTypeWorkflow());
    expect(screen.getByText("When it's sent to the client")).toBeTruthy();
    // Exactly one letter control in the whole editor. getAllByText would
    // return 6 if the per-stage toggle ever crept back.
    expect(
      screen.getAllByText("Send the engagement letter for signature"),
    ).toHaveLength(1);
    expect(screen.queryByText("Send engagement letter")).toBeNull();
    // The other stage actions are still offered per stage (5 working stages
    // for the return flow — completed renders no action row).
    expect(screen.getAllByText("Send the invoice").length).toBeGreaterThan(1);
  });

  it("toggling the letter off strips it from the whole flow", () => {
    const onChange = vi.fn<(next: WorkflowDefinition) => void>();
    mount(returnTypeWorkflow(), onChange);
    const toggle = screen
      .getByText("Send the engagement letter for signature")
      .closest("label")!
      .querySelector("button")!;
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(flowSendsLetter(next)).toBe(false);
    // Collecting keeps its other entry action.
    expect(next.stages.collecting.on_entry).toEqual(["activate_checklist"]);
  });
});
