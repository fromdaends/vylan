import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { EngagementStagePills } from "./engagement-stage-pills";

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
