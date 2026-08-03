"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  bulkDeleteDocumentsAction,
  restoreDocumentAction,
} from "@/app/actions/documents";
import {
  parseSelectionKey,
  selectionKey,
  useFileSelection,
  type SelectedFolder,
} from "./file-selection";
import { BulkBar } from "./bulk-bar";

// DRIVE'S SELECTION MODEL (Files v2 §7) — the founder's exact words: "when
// you click on one, it turns blue. You have to double click to open it."
//
// This is ALSO the latency fix. Every row used to be a link, so every stray
// click was a full server navigation — click around a folder and the app
// feels slow because each click IS a page load. Now a single click only
// flips local selection state (instant, zero network), and navigation costs
// are paid exactly once, on an intentional double-click. Folder targets are
// prefetched the moment the pointer touches a row, so that double-click
// lands on a route that is already in the client cache.
//
//   single click   select (hard Drive blue) — the action bar pops up on top
//   double click   open: folders navigate, files open their preview
//   Esc / empty    clear the selection
//   Delete         soft-delete the selected FILES, with an Undo toast
//
// Folders are single-select and the Delete key never touches them — a
// keyboard slip must not be able to unfile a folder's contents. Selecting a
// folder still pops the bar (Open, and Rename/Delete for folders the firm
// made), because "nothing pops up when you click on a folder" reads as
// broken next to the file behaviour.

type RowsContext = {
  selectedFolder: SelectedFolder | null;
  setSelectedFolder: (sel: SelectedFolder | null) => void;
  /** File keys in RENDER order — what makes Shift-click's "everything between
   * these two" well-defined. */
  orderedKeys: string[];
  /** The range anchor: the last row plainly clicked. */
  anchorKey: string | null;
  setAnchorKey: (key: string | null) => void;
};

const Ctx = createContext<RowsContext | null>(null);

/** The client surface around the row list: folder selection, Esc / Delete
 * keys, click-on-empty-space to clear, and the Drive-style action bar that
 * pops up over the list whenever anything is selected. */
export function RowsSurface({
  locale = "en",
  folders,
  orderedFiles,
  children,
}: {
  locale?: "en" | "fr";
  /** The current client's custom folders, for the bar's "File into". */
  folders?: { id: string; name: string }[];
  /** The page's file rows in render order, as raw {source,id} pairs — the
   * SERVER list builds this (it cannot call selectionKey itself: importing
   * from a "use client" module turns the import into a stub there). */
  orderedFiles?: { source: string; id: string }[];
  children: ReactNode;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const selection = useFileSelection();
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(null);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const orderedKeys = (orderedFiles ?? []).map((f) => selectionKey(f.source, f.id));

  const clearAll = useCallback(() => {
    setSelectedFolder(null);
    setAnchorKey(null);
    selection?.clear();
  }, [selection]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never fight a form field.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.key === "Escape") {
        clearAll();
        return;
      }
      if (e.key === "Delete" && selection && selection.selected.size > 0) {
        e.preventDefault();
        const targets = [...selection.selected].map(parseSelectionKey);
        startTransition(async () => {
          const res = await bulkDeleteDocumentsAction({ targets });
          selection.clear();
          router.refresh();
          if (!res.ok && res.succeeded === 0) {
            toast.error(t("action_failed"));
            return;
          }
          // Drive's contract: deleting from the keyboard is safe because undo
          // is RIGHT THERE. Restore uses the same recycle-bin machinery as the
          // Recently deleted screen, so undo is real, not cosmetic.
          toast.success(t("bulk_deleted", { count: res.succeeded }), {
            action: {
              label: t("undo"),
              onClick: () => {
                startTransition(async () => {
                  for (const tgt of targets) {
                    await restoreDocumentAction(tgt);
                  }
                  router.refresh();
                });
              },
            },
          });
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, clearAll, router, t, startTransition]);

  return (
    <Ctx.Provider
      value={{ selectedFolder, setSelectedFolder, orderedKeys, anchorKey, setAnchorKey }}
    >
      <BulkBar
        locale={locale}
        folders={folders}
        folderSelection={selectedFolder}
        onClearFolder={() => setSelectedFolder(null)}
      />
      <div
        onClick={(e) => {
          // A click that lands on the surface itself (not on a row) clears —
          // rows stop propagation of the clicks they handle.
          if (e.target === e.currentTarget) clearAll();
        }}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function SelectableRow({
  kind,
  rowKey,
  name,
  href,
  previewUrl,
  source,
  id,
  manage,
  children,
}: {
  kind: "folder" | "file";
  /** Unique within the list (folder id or source|id). */
  rowKey: string;
  /** Display name — the action bar says what is selected. */
  name?: string;
  /** Folder navigation target — used on DOUBLE click. */
  href?: string;
  /** File preview target — opened in a new tab on double click. */
  previewUrl?: string;
  source?: string;
  id?: string;
  /** Rename/delete identity, only for folders the firm made. */
  manage?: { clientId: string; folderId: string } | null;
  children: ReactNode;
}) {
  const rows = useContext(Ctx);
  const selection = useFileSelection();
  const router = useRouter();
  const prefetched = useRef(false);

  const fileKey = source && id ? selectionKey(source, id) : null;
  const isSelected =
    kind === "folder"
      ? rows?.selectedFolder?.key === rowKey
      : !!fileKey && !!selection?.selected.has(fileKey);

  function open() {
    if (kind === "folder" && href) {
      router.push(href);
    } else if (kind === "file" && previewUrl) {
      window.open(previewUrl, "_blank", "noopener");
    }
  }

  function selectFolder(on: boolean) {
    rows?.setSelectedFolder(
      on && href
        ? { key: rowKey, name: name ?? "", href, manage: manage ?? null }
        : null,
    );
  }

  function onClick(e: ReactMouseEvent) {
    // Row controls (menus, checkboxes, the From link) own their clicks.
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input, [role=menuitem], [role=checkbox]")) return;
    e.stopPropagation();
    // Clicking a row SELECTS it — including a row that is already selected.
    // Drive never deselects on a re-click (founder: "when you click it a
    // second time it shouldn't close"); getting OUT of a selection is what
    // the bar's X, Esc, another row, or empty space are for. Ctrl/Cmd-click
    // stays a true toggle, and Shift-click selects the whole RANGE between
    // the last plainly-clicked row (the anchor) and this one.
    if (kind === "folder") {
      selectFolder(true);
      selection?.clear();
    } else if (fileKey && selection) {
      if (e.shiftKey && rows) {
        // The anchor stays put across repeated shift-clicks, so you can
        // widen or narrow the range — Drive's exact behaviour. Falls back to
        // a plain single-select when there is no usable anchor.
        const a = rows.orderedKeys.indexOf(rows.anchorKey ?? fileKey);
        const b = rows.orderedKeys.indexOf(fileKey);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          selection.clear();
          selection.setMany(rows.orderedKeys.slice(lo, hi + 1), true);
          if (rows.anchorKey === null) rows.setAnchorKey(fileKey);
        }
      } else if (e.ctrlKey || e.metaKey) {
        selection.toggle(fileKey);
        rows?.setAnchorKey(fileKey);
      } else {
        if (!(selection.selected.has(fileKey) && selection.selected.size === 1)) {
          selection.clear();
          selection.toggle(fileKey);
        }
        rows?.setAnchorKey(fileKey);
      }
      rows?.setSelectedFolder(null);
    }
  }

  function onDoubleClick(e: ReactMouseEvent) {
    const el = e.target as HTMLElement;
    if (el.closest("button, input, [role=menuitem], [role=checkbox]")) return;
    e.stopPropagation();
    open();
  }

  // Folder rows used to be real links; now that a click means "select",
  // keyboard users still need a way in — Enter opens, Space selects.
  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      open();
    } else if (e.key === " ") {
      e.preventDefault();
      if (kind === "folder") {
        selectFolder(!isSelected);
      } else if (fileKey && selection) {
        selection.toggle(fileKey);
      }
    }
  }

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerEnter={() => {
        // Warm the route on first touch so the double-click that follows
        // navigates from the client cache instead of a cold server roundtrip
        // — the visible part of "there's a ton of latency".
        if (kind === "folder" && href && !prefetched.current) {
          prefetched.current = true;
          router.prefetch(href);
        }
      }}
      tabIndex={0}
      role="button"
      className={cn(
        // "group" lets the row divs inside drop their gray hover wash while
        // selected (see ROW_CLASS) — gray over the blue muddied it.
        "group cursor-default select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // Drive's bright, HARD blue — an opaque token, not a translucent
        // accent wash ("it is too dark" was the review of the wash).
        isSelected && "bg-(--selection)",
      )}
      data-selected={isSelected || undefined}
    >
      {children}
    </div>
  );
}
