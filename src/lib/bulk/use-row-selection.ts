"use client";

// The selection state every bulk-capable list keeps.
//
// One hook rather than three copies, for the reason the cohesion rule gives:
// "select all" and "does the header tick clear or fill" are decisions that must
// be identical on tasks, clients and engagements, and three hand-rolled Sets
// drift the first time one of them is touched.

import { useCallback, useMemo, useState } from "react";
import { headerState, toggleAll } from "@/lib/bulk/selection";

export function useRowSelection(visibleIds: readonly string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Rows leave the list — filtered out, deleted, paged past — and a selection
  // holding ids that are no longer on screen is how a bulk action reaches
  // something the user cannot see. Derived rather than pruned in an effect: an
  // effect would paint the stale count first and trips
  // react-hooks/set-state-in-effect.
  const visibleKey = visibleIds.join(",");
  const ids = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleKey, selected],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleHeader = useCallback(() => {
    setSelected((prev) => toggleAll(visibleIds, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    /** Selected ids, always a subset of what is on screen. */
    ids,
    count: ids.length,
    isSelected: useCallback((id: string) => selected.has(id), [selected]),
    toggle,
    toggleHeader,
    header: headerState(visibleIds, selected),
    clear,
  };
}
