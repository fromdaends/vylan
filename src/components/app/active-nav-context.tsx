"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { EngagementView } from "@/lib/engagements/views";

// Lets a deep page (an engagement detail page) tell the sidebar — which lives
// in the same AppShell, a sibling rendered above the page — which Engagements
// sub-view to highlight. The provider sits in AppShell, so context flows down
// to BOTH the sidebar and {children}: the page publishes its view, the sidebar
// reads it. Mirrors the existing RecordEngagementOpen pattern (a render-nothing
// marker component that writes to shared state on mount).

type ActiveNavValue = {
  // The engagement-detail view to highlight, or null when not on a detail page.
  engagementDetailView: EngagementView | null;
  setEngagementDetailView: (view: EngagementView | null) => void;
};

const ActiveNavContext = createContext<ActiveNavValue | null>(null);

export function ActiveNavProvider({ children }: { children: ReactNode }) {
  const [engagementDetailView, setEngagementDetailView] =
    useState<EngagementView | null>(null);
  return (
    <ActiveNavContext.Provider
      value={{ engagementDetailView, setEngagementDetailView }}
    >
      {children}
    </ActiveNavContext.Provider>
  );
}

// Read the active engagement-detail view. Returns null outside the provider, so
// the sidebar degrades cleanly to pure route-based highlighting.
export function useActiveEngagementView(): EngagementView | null {
  return useContext(ActiveNavContext)?.engagementDetailView ?? null;
}

// Render-nothing marker: an engagement detail page drops this with its computed
// view (via engagementToView) so the sidebar highlights the matching sub-page.
// Clears on unmount / navigation away. No-op if rendered outside the provider.
export function SetEngagementDetailView({ view }: { view: EngagementView }) {
  const ctx = useContext(ActiveNavContext);
  const setView = ctx?.setEngagementDetailView;
  useEffect(() => {
    if (!setView) return;
    setView(view);
    return () => setView(null);
  }, [view, setView]);
  return null;
}
