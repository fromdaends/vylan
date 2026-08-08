import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { EngagementStagePills } from "./engagement-stage-pills";
import type { AgreementStatus } from "@/lib/engagements/agreement";

function mount(status: Parameters<typeof EngagementStagePills>[0]["status"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementStagePills status={status} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("EngagementStagePills", () => {
  it("collapses passed stages into one pill and expands on click", () => {
    mount("active");
    // Draft / Sent / Accepted are behind "active" → one collapsed pill.
    expect(screen.getByText("3 earlier stages")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();

    fireEvent.click(screen.getByText("3 earlier stages"));
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();

    // Clicking any expanded passed pill re-collapses.
    fireEvent.click(screen.getByText("Sent"));
    expect(screen.getByText("3 earlier stages")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("shows a single passed stage plainly — no collapse for one", () => {
    mount("sent");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByText(/earlier stage/)).toBeNull();
  });

  it("a draft has no passed stages and every later stage ahead", () => {
    mount("draft");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.queryByText(/earlier stage/)).toBeNull();
  });

  it("cancelled renders one destructive pill, not a path", () => {
    mount("cancelled");
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByText("Complete")).toBeNull();
  });
});

function renderPills(status: AgreementStatus, showAccepted: boolean) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementStagePills status={status} showAccepted={showAccepted} />
    </NextIntlClientProvider>
  );
}

describe("⚠️ the rail never ticks a stage nobody was asked to pass", () => {
  it("drops Accepted when the engagement has no accept step", () => {
    // The pills tick every stage BEFORE the current one, so an engagement that
    // reached "active" without an accept step drew a checkmark on Accepted —
    // a claim that a client agreed to something, on a screen about a contract.
    render(renderPills("active", false));
    expect(screen.queryByText(en.Engagements.agr_accepted)).toBeNull();
  });

  it("keeps Accepted when acceptance IS part of this engagement", () => {
    render(renderPills("sent", true));
    expect(screen.getByText(en.Engagements.agr_accepted)).toBeTruthy();
  });

  it("keeps Accepted on an engagement that was actually accepted", () => {
    // Even with the flag off — it happened, so the rail must show it.
    render(renderPills("accepted", false));
    expect(screen.getByText(en.Engagements.agr_accepted)).toBeTruthy();
  });
});
