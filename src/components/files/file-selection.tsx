"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Multi-select for the file list.
//
// The list itself stays a SERVER component — it renders folder and file rows
// with no client JavaScript, which is what keeps a 50-row page cheap. Selection
// is layered on as client islands: a provider around the page, a checkbox per
// file row, and the action bar. Converting the whole list to a client component
// to get a checkbox would have meant shipping every row's markup twice.
//
// Keyed by "source:id" because an id is only unique WITHIN its table — a
// checklist upload and an imported document can in principle collide, and a
// bulk delete that hit the wrong table because of it would be unrecoverable
// within the 30-day window and silent outside it.

export type SelectionKey = string;

/** A selected FOLDER row (single-select, lives in RowsSurface). Declared here
 * so the row surface and the action bar can share it without importing each
 * other. `manage` is present only for folders the firm made — the ones the
 * bar can rename or delete. */
export type SelectedFolder = {
  key: string;
  name: string;
  href: string;
  manage?: { clientId: string; folderId: string } | null;
};

export function selectionKey(source: string, id: string): SelectionKey {
  return `${source}:${id}`;
}

export function parseSelectionKey(key: SelectionKey): { source: string; id: string } {
  const at = key.indexOf(":");
  return { source: key.slice(0, at), id: key.slice(at + 1) };
}

type SelectionContext = {
  selected: ReadonlySet<SelectionKey>;
  toggle: (key: SelectionKey) => void;
  clear: () => void;
  setMany: (keys: SelectionKey[], on: boolean) => void;
};

const Ctx = createContext<SelectionContext | null>(null);

export function FileSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<SelectionKey>>(
    () => new Set(),
  );

  const toggle = useCallback((key: SelectionKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const setMany = useCallback((keys: SelectionKey[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ selected, toggle, clear, setMany }),
    [selected, toggle, clear, setMany],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Selection state, or null outside a provider.
 *
 * Nullable on purpose: the same row components render in views that have no
 * bulk actions (the recycle bin), and throwing there would be a crash in
 * exchange for nothing.
 */
export function useFileSelection(): SelectionContext | null {
  return useContext(Ctx);
}
