import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StageFilterSelect } from "./stage-filter-select";
import { countByStage } from "@/lib/engagements/stage-filter";
import type { EngagementStage } from "@/lib/engagements/stage";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// Radix Select leans on a few DOM APIs happy-dom doesn't implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

const counts = (over: Partial<Record<EngagementStage, number>> = {}) => ({
  ...countByStage([]),
  ...over,
});

function renderSelect(
  over: {
    counts?: Record<EngagementStage, number>;
    selected?: EngagementStage | null;
    messages?: typeof en;
    locale?: string;
  } = {},
) {
  const onSelect = vi.fn();
  render(
    <NextIntlClientProvider
      locale={over.locale ?? "en"}
      messages={over.messages ?? en}
    >
      <StageFilterSelect
        counts={over.counts ?? counts({ collecting: 12, in_review: 3 })}
        selected={over.selected ?? null}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return { onSelect };
}

// Radix Select opens on KEYBOARD here — unlike DropdownMenu (pointer-down), its
// pointer path needs layout APIs happy-dom doesn't provide. ArrowDown is a real
// way users open it, so this isn't a synthetic shortcut.
function openMenu(name = en.Stage.filter_label) {
  const trigger = screen.getByRole("combobox", { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

describe("StageFilterSelect", () => {
  it("is ONE control, not a row of chips — the whole point of the dropdown", () => {
    renderSelect();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    // Nothing but the trigger is on screen until it's opened.
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("reads 'All stages' when nothing is filtered", () => {
    renderSelect({ selected: null });
    expect(
      screen.getByRole("combobox", { name: en.Stage.filter_label }),
    ).toHaveTextContent(en.Stage.filter_all);
  });

  it("'All stages' is distinct from the neighbouring my/all scope box's 'All'", () => {
    // Both pickers sit side by side now; two controls both reading "All" would
    // be a coin flip for the accountant.
    expect(en.Stage.filter_all).not.toBe(en.Engagements.scope_all);
    expect(fr.Stage.filter_all).not.toBe(fr.Engagements.scope_all);
  });

  it("shows the selected stage with its count on the trigger", () => {
    renderSelect({ selected: "collecting" });
    expect(
      screen.getByRole("combobox", { name: en.Stage.filter_label }),
    ).toHaveTextContent("Collecting documents (12)");
  });

  it("offers All stages plus every filterable stage, in workflow order", () => {
    renderSelect();
    openMenu();
    const options = screen.getAllByRole("option").map((o) => o.textContent?.trim());
    expect(options).toEqual([
      en.Stage.filter_all,
      "Collecting documents (12)",
      "In review (3)",
      "In preparation (0)",
      "Awaiting signature (0)",
      "Awaiting payment (0)",
    ]);
  });

  it("has no Completed option — that work lives in the Completed tab", () => {
    renderSelect();
    openMenu();
    expect(
      screen.queryByRole("option", { name: /Completed/i }),
    ).not.toBeInTheDocument();
  });

  it("selects a stage", () => {
    const { onSelect } = renderSelect();
    openMenu();
    fireEvent.click(screen.getByRole("option", { name: /Collecting documents/ }));
    expect(onSelect).toHaveBeenCalledWith("collecting");
  });

  it("'All stages' clears the filter to null, not the string 'all'", () => {
    // The caller maps null -> no ?stage= param; leaking the sentinel would put
    // ?stage=all in a URL people share.
    const { onSelect } = renderSelect({ selected: "collecting" });
    openMenu();
    fireEvent.click(screen.getByRole("option", { name: en.Stage.filter_all }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("still lists a stage with a zero count", () => {
    // Its emptiness is information, and a menu that reshuffles as work moves is
    // harder to learn than one that holds still.
    renderSelect({ counts: counts({ awaiting_signature: 0 }) });
    openMenu();
    expect(
      screen.getByRole("option", { name: /Awaiting signature \(0\)/ }),
    ).toBeInTheDocument();
  });

  it("renders in French", () => {
    renderSelect({ messages: fr, locale: "fr", selected: "in_preparation" });
    expect(
      screen.getByRole("combobox", { name: fr.Stage.filter_label }),
    ).toHaveTextContent("En préparation (0)");
  });
});
