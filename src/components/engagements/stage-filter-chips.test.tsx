import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StageFilterChips } from "./stage-filter-chips";
import { countByStage } from "@/lib/engagements/stage-filter";
import type { EngagementStage } from "@/lib/engagements/stage";
import en from "../../../messages/en.json";

afterEach(cleanup);

const counts = (over: Partial<Record<EngagementStage, number>> = {}) => ({
  ...countByStage([]),
  ...over,
});

function renderChips(
  over: {
    counts?: Record<EngagementStage, number>;
    selected?: EngagementStage | null;
    onSelect?: (s: EngagementStage | null) => void;
  } = {},
) {
  const onSelect = over.onSelect ?? vi.fn();
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StageFilterChips
        counts={over.counts ?? counts({ collecting: 12, in_review: 3 })}
        selected={over.selected ?? null}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return { onSelect, q: within(container) };
}

// The chip a user aims at is identified by its aria-label ("Collecting
// documents (12)"), since the visible text is split across spans.
const chip = (label: string, count: number) =>
  screen.getByRole("button", {
    name: en.Stage.filter_chip
      .replace("{label}", label)
      .replace("{count}", String(count)),
  });

describe("StageFilterChips", () => {
  it("offers All plus one chip per stage, in workflow order", () => {
    const { q } = renderChips();
    const names = q
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(names[0]).toBe(en.Stage.filter_all);
    expect(names.slice(1)).toEqual([
      "Collecting documents (12)",
      "In review (3)",
      "In preparation (0)",
      "Awaiting signature (0)",
      "Awaiting payment (0)",
    ]);
  });

  it("has no Completed chip — that work lives in the Completed tab", () => {
    const { q } = renderChips();
    expect(
      q.queryByRole("button", { name: /Completed/i }),
    ).not.toBeInTheDocument();
  });

  it("shows each stage's count", () => {
    renderChips();
    expect(chip("Collecting documents", 12)).toBeInTheDocument();
    expect(chip("In review", 3)).toBeInTheDocument();
  });

  it("marks All as pressed when nothing is filtered", () => {
    const { q } = renderChips({ selected: null });
    expect(q.getByRole("button", { name: en.Stage.filter_all })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("marks only the selected stage as pressed — never two at once", () => {
    const { q } = renderChips({ selected: "in_review" });
    const pressed = q
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe("In review (3)");
  });

  it("selects a stage on click", () => {
    const { onSelect } = renderChips();
    fireEvent.click(chip("Collecting documents", 12));
    expect(onSelect).toHaveBeenCalledWith("collecting");
  });

  it("clicking the ACTIVE chip again clears the filter", () => {
    const { onSelect } = renderChips({ selected: "collecting" });
    fireEvent.click(chip("Collecting documents", 12));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("All clears the filter", () => {
    const { onSelect, q } = renderChips({ selected: "collecting" });
    fireEvent.click(q.getByRole("button", { name: en.Stage.filter_all }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("keeps a zero-count chip visible but dimmed", () => {
    // Its absence is information ("nobody is waiting to sign"), and a chip row
    // that reshuffles as work moves is harder to aim at than one that holds still.
    renderChips({ counts: counts({ awaiting_signature: 0 }) });
    const zero = chip("Awaiting signature", 0);
    expect(zero).toBeVisible();
    expect(zero.className).toContain("opacity-40");
    // Still clickable — the empty state explains itself.
    expect(zero).not.toBeDisabled();
  });

  it("does not dim a zero-count chip that is currently selected", () => {
    // Dimming the chip you just clicked would read as disabled and strand it.
    renderChips({
      counts: counts({ awaiting_payment: 0 }),
      selected: "awaiting_payment",
    });
    expect(chip("Awaiting payment", 0).className).not.toContain("opacity-40");
  });

  it("renders in French", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fr = require("../../../messages/fr.json");
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <StageFilterChips
          counts={counts({ collecting: 2 })}
          selected={null}
          onSelect={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("button", { name: fr.Stage.filter_all }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Collecte de documents \(2\)/ }),
    ).toBeInTheDocument();
  });
});
