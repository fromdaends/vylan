import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeAssistant,
  getAssistantState,
  openAssistant,
  setAssistantTab,
  setPageEngagement,
  setSelectedEngagement,
  subscribeAssistant,
} from "./assistant-store";

// The store is module-level state — reset it between tests through its own
// public API so tests stay honest about the surface components use.
beforeEach(() => {
  closeAssistant();
  setAssistantTab("chat");
  setPageEngagement(null);
  setSelectedEngagement(null);
});

describe("assistant store", () => {
  it("opens on the current tab by default and on a named tab when asked", () => {
    openAssistant();
    expect(getAssistantState().open).toBe(true);
    expect(getAssistantState().tab).toBe("chat");

    closeAssistant();
    openAssistant("activity");
    expect(getAssistantState().open).toBe(true);
    expect(getAssistantState().tab).toBe("activity");
  });

  it("close keeps the tab so reopening restores the last view", () => {
    openAssistant("activity");
    closeAssistant();
    expect(getAssistantState().open).toBe(false);
    expect(getAssistantState().tab).toBe("activity");
  });

  it("publishes and clears the page engagement", () => {
    const engagement = {
      id: "e1",
      title: "T1 2025",
      clientName: "Client Inc",
      status: "sent",
      createdAt: "2026-07-01T00:00:00Z",
    };
    setPageEngagement(engagement);
    expect(getAssistantState().pageEngagement).toEqual(engagement);
    setPageEngagement(null);
    expect(getAssistantState().pageEngagement).toBeNull();
  });

  it("preselects the page engagement on a closed → open transition", () => {
    setPageEngagement({
      id: "e1",
      title: "T1 2025",
      clientName: "Client Inc",
      status: "sent",
      createdAt: "2026-07-01T00:00:00Z",
    });
    openAssistant();
    expect(getAssistantState().selected).toEqual({
      id: "e1",
      title: "T1 2025",
      clientName: "Client Inc",
      status: "sent",
    });
  });

  it("keeps a manual pick while the panel stays open, and re-preselects on reopen", () => {
    setPageEngagement({
      id: "e1",
      title: "T1 2025",
      clientName: "Client Inc",
      status: "sent",
      createdAt: "2026-07-01T00:00:00Z",
    });
    openAssistant();
    // Manual pick of another engagement while open sticks…
    setSelectedEngagement({
      id: "e2",
      title: "T2 2025",
      clientName: null,
      status: "in_progress",
    });
    openAssistant("activity"); // already open — must NOT re-preselect
    expect(getAssistantState().selected?.id).toBe("e2");

    // …but a fresh open on the engagement page preselects again.
    closeAssistant();
    openAssistant();
    expect(getAssistantState().selected?.id).toBe("e1");
  });

  it("opening without a page engagement keeps the previous selection", () => {
    setSelectedEngagement({
      id: "e9",
      title: "Books 2025",
      clientName: null,
      status: "sent",
    });
    openAssistant();
    expect(getAssistantState().selected?.id).toBe("e9");
  });

  it("notifies subscribers on every transition and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAssistant(listener);

    openAssistant();
    setAssistantTab("activity");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    closeAssistant();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("state objects are immutable snapshots (new reference per change)", () => {
    const before = getAssistantState();
    openAssistant();
    const after = getAssistantState();
    expect(after).not.toBe(before);
    expect(before.open).toBe(false);
    expect(after.open).toBe(true);
  });
});
