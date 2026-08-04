import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

import { AgreementStepper } from "./agreement-stepper";
import type { AgreementStatus } from "@/lib/engagements/agreement";

function renderStepper(status: AgreementStatus) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AgreementStepper status={status} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("AgreementStepper", () => {
  it("names the state the engagement is actually in", () => {
    renderStepper("sent");
    expect(screen.getByText(en.Engagements.agr_sent)).toBeTruthy();
  });

  // ⚠️ THE ONE THAT ENFORCES THE FOUNDER'S ASK. They said the old workflow
  // words should "only exist for document collection", so none of them may
  // appear on the engagement header — not as a label, not as a dot tooltip.
  it("NEVER shows a workflow stage word", () => {
    for (const status of ["draft", "sent", "active", "complete"] as const) {
      cleanup();
      renderStepper(status);
      const text = document.body.textContent ?? "";
      const titles = [...document.querySelectorAll("[title]")]
        .map((e) => e.getAttribute("title"))
        .join(" ");
      // Guard the guard: a mistyped key makes every assertion below vacuous,
      // which is exactly how this test passed while the component WAS printing
      // "In preparation". tsc caught it; this line stops it coming back.
      for (const stageWord of [
        en.Stage.stage_collecting,
        en.Stage.stage_in_review,
        en.Stage.stage_in_preparation,
        en.Stage.stage_awaiting_signature,
        en.Stage.stage_awaiting_payment,
      ]) {
        expect(typeof stageWord).toBe("string");
        expect(stageWord.length).toBeGreaterThan(3);
        expect(text).not.toContain(stageWord);
        expect(titles).not.toContain(stageWord);
      }
    }
  });

  // It replaced a DROPDOWN. An agreement status is derived from facts, so
  // offering to set one would be a control that lies — you cannot mark a job
  // "Accepted" when no client accepted it.
  it("is read-only — no control to set a status by hand", () => {
    renderStepper("active");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("marks where it has got to", () => {
    renderStepper("active");
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain(en.Engagements.agr_active);
  });

  // Cancelled can happen from anywhere, so drawing it as the last node would
  // say every live engagement is one step from being cancelled.
  it("drops the rail entirely when the agreement was cancelled", () => {
    renderStepper("cancelled");
    expect(screen.getByText(en.Engagements.agr_cancelled)).toBeTruthy();
    expect(document.querySelector('[role="group"]')).toBeNull();
  });
});
