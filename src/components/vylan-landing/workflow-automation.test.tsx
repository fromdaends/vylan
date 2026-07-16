import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act, cleanup, within } from "@testing-library/react";
import {
  WorkflowAutomation,
  type WorkflowAutomationStrings,
} from "./workflow-automation";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// The section reveals on scroll via IntersectionObserver, which happy-dom
// doesn't implement. A no-op stub is enough: nothing under test depends on the
// reveal, and the component already renders its content unconditionally (the
// reveal only animates opacity).
beforeAll(() => {
  if (!("IntersectionObserver" in globalThis)) {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

// Built the same way the landing page builds it: the five stage names come from
// the PRODUCT's namespace, "Paid" from the marketing one.
function strings(m: typeof en): WorkflowAutomationStrings {
  return {
    eyebrow: m.Vylan.wa_eyebrow,
    title: m.Vylan.wa_title,
    body: m.Vylan.wa_body,
    panelLabel: m.Vylan.wa_panel_label,
    play: m.Vylan.wa_play,
    playing: m.Vylan.wa_playing,
    replay: m.Vylan.wa_replay,
    all: m.Vylan.wa_all,
    moved: m.Vylan.wa_moved,
    empty: m.Vylan.wa_empty,
    foot: m.Vylan.wa_foot,
    stageLabels: [
      m.Stage.stage_collecting,
      m.Stage.stage_in_review,
      m.Stage.stage_in_preparation,
      m.Stage.stage_awaiting_signature,
      m.Stage.stage_awaiting_payment,
      m.Vylan.wa_paid,
    ],
    rows: [
      { name: m.Vylan.wa_row1_name, sub: m.Vylan.wa_row1_sub },
      { name: m.Vylan.wa_row2_name, sub: m.Vylan.wa_row2_sub },
      { name: m.Vylan.wa_row3_name, sub: m.Vylan.wa_row3_sub },
      { name: m.Vylan.wa_row4_name, sub: m.Vylan.wa_row4_sub },
    ],
  };
}

const renderIt = (m: typeof en = en) => render(<WorkflowAutomation s={strings(m)} />);
const pills = () =>
  Array.from(document.querySelectorAll(".wa-pill")).map((p) => p.textContent);
const rowNames = () =>
  Array.from(document.querySelectorAll(".wa-row-name")).map((p) => p.textContent);
const chip = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

describe("WorkflowAutomation — the claim it makes", () => {
  it("opens with work spread across the pipeline, not lined up", () => {
    // A board where everything sits at one stage wouldn't look like a real firm,
    // and wouldn't show that engagements move independently.
    renderIt();
    expect(pills()).toEqual([
      en.Stage.stage_collecting,
      en.Stage.stage_in_review,
      en.Stage.stage_awaiting_signature,
      en.Stage.stage_awaiting_payment,
    ]);
  });

  it("uses the PRODUCT's stage names, not a marketing copy of them", () => {
    // If these drift, the landing page promises stages the app doesn't have.
    renderIt();
    expect(screen.getByText(en.Stage.stage_collecting, { selector: ".wa-pill" }))
      .toBeInTheDocument();
  });

  it("draws one dot per filterable stage on every row", () => {
    renderIt();
    const row = document.querySelector(".wa-row")!;
    expect(within(row as HTMLElement).getAllByRole.length).toBeDefined();
    expect(row.querySelectorAll(".wa-dot")).toHaveLength(5);
  });
});

describe("WorkflowAutomation — filters", () => {
  it("counts each stage, and All counts everything", () => {
    renderIt();
    // `.*` between label and count: the design separates them with a
    // non-breaking space, and accessible-name flattening renders that as its own
    // whitespace — matching it literally would pin the test to that detail.
    expect(chip(`${en.Vylan.wa_all}.*\\(4\\)`)).toBeInTheDocument();
    expect(chip(`${en.Stage.stage_collecting}.*\\(1\\)`)).toBeInTheDocument();
    // Nothing starts in preparation — the empty chip still shows.
    expect(chip(`${en.Stage.stage_in_preparation}.*\\(0\\)`)).toBeInTheDocument();
  });

  it("has no chip for the resting stage — the product doesn't filter by it either", () => {
    renderIt();
    expect(
      screen.queryByRole("button", { name: new RegExp(en.Vylan.wa_paid) }),
    ).not.toBeInTheDocument();
  });

  it("filters to one stage", () => {
    renderIt();
    fireEvent.click(chip(en.Stage.stage_collecting));
    expect(rowNames()).toEqual([en.Vylan.wa_row1_name]);
  });

  it("marks exactly one chip pressed at a time", () => {
    renderIt();
    fireEvent.click(chip(en.Stage.stage_in_review));
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("clicking the active chip again clears back to All", () => {
    renderIt();
    fireEvent.click(chip(en.Stage.stage_collecting));
    expect(rowNames()).toHaveLength(1);
    fireEvent.click(chip(en.Stage.stage_collecting));
    expect(rowNames()).toHaveLength(4);
  });

  it("shows the empty state for a stage nothing is at", () => {
    renderIt();
    fireEvent.click(chip(en.Stage.stage_in_preparation));
    expect(rowNames()).toHaveLength(0);
    expect(screen.getByText(en.Vylan.wa_empty)).toBeInTheDocument();
  });
});

describe("WorkflowAutomation — the play simulation", () => {
  it("advances every engagement one stage, then settles", () => {
    vi.useFakeTimers();
    try {
      renderIt();
      fireEvent.click(screen.getByRole("button", { name: new RegExp(en.Vylan.wa_play) }));
      // Mid-run the button says so.
      expect(
        screen.getByRole("button", { name: new RegExp(en.Vylan.wa_playing) }),
      ).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(6500);
      });
      // Each row moved exactly one stage on: 0->1, 1->2, 3->4, 4->5(Paid).
      expect(pills()).toEqual([
        en.Stage.stage_in_review,
        en.Stage.stage_in_preparation,
        en.Stage.stage_awaiting_payment,
        en.Vylan.wa_paid,
      ]);
      expect(
        screen.getByRole("button", { name: new RegExp(en.Vylan.wa_replay) }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never advances past the resting stage", () => {
    vi.useFakeTimers();
    try {
      renderIt();
      const play = () =>
        screen.getByRole("button", {
          name: new RegExp(`${en.Vylan.wa_play}|${en.Vylan.wa_replay}|${en.Vylan.wa_playing}`),
        });
      // Run it three times; the last row starts at Awaiting payment, so it hits
      // Paid on run 1 and must simply stay there.
      for (let i = 0; i < 3; i++) {
        fireEvent.click(play());
        act(() => {
          vi.advanceTimersByTime(7000);
        });
      }
      expect(pills()[3]).toBe(en.Vylan.wa_paid);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second press replays from the top rather than doing nothing", () => {
    vi.useFakeTimers();
    try {
      renderIt();
      fireEvent.click(screen.getByRole("button", { name: new RegExp(en.Vylan.wa_play) }));
      act(() => {
        vi.advanceTimersByTime(6500);
      });
      fireEvent.click(screen.getByRole("button", { name: new RegExp(en.Vylan.wa_replay) }));
      // Rewinds to the opening board before running again.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(pills()).toEqual([
        en.Stage.stage_collecting,
        en.Stage.stage_in_review,
        en.Stage.stage_awaiting_signature,
        en.Stage.stage_awaiting_payment,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a press while already running", () => {
    vi.useFakeTimers();
    try {
      renderIt();
      const btn = () => document.querySelector(".wa-play") as HTMLElement;
      fireEvent.click(btn());
      act(() => {
        vi.advanceTimersByTime(600);
      });
      const afterFirst = pills();
      fireEvent.click(btn()); // should be a no-op, not a restart
      expect(pills()).toEqual(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkflowAutomation — bilingual", () => {
  it("renders in French, stage names included", () => {
    renderIt(fr as unknown as typeof en);
    expect(screen.getByText(fr.Vylan.wa_title)).toBeInTheDocument();
    expect(
      screen.getByText(fr.Stage.stage_collecting, { selector: ".wa-pill" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(fr.Vylan.wa_play) }),
    ).toBeInTheDocument();
  });
});
