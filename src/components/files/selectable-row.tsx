"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import { parseSelectionKey, selectionKey, useFileSelection } from "./file-selection";

// DRIVE'S SELECTION MODEL (Files v2 §7) — the founder's exact words: "when
// you click on one, it turns blue. You have to double click to open it."
//
// This is ALSO the latency fix. Every row used to be a link, so every stray
// click was a full server navigation — click around a folder and the app
// feels slow because each click IS a page load. Now a single click only
// flips local selection state (instant, zero network), and navigation costs
// are paid exactly once, on an intentional double-click.
//
//   single click   select (blue) — files feed the bulk action bar
//   double click   open: folders navigate, files open their preview
//   Esc / empty    clear the selection
//   Delete         soft-delete the selected FILES, with an Undo toast
//
// Folders are single-select and the Delete key never touches them — a
// keyboard slip must not be able to unfile a folder's contents.

type RowsContext = {
  selectedFolder: string | null;
  setSelectedFolder: (key: string | null) => void;
};

const Ctx = createContext<RowsContext | null>(null);

/** The client surface around the row list: folder selection, Esc / Delete
 * keys, and click-on-empty-space to clear. Rendered by the server-side
 * FileBrowser around its <ul>. */
export function RowsSurface({ children }: { children: ReactNode }) {
  const t = useTranslations("Files");
  const router = useRouter();
  const selection = useFileSelection();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const clearAll = useCallback(() => {
    setSelectedFolder(null);
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
    <Ctx.Provider value={{ selectedFolder, setSelectedFolder }}>
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
  href,
  previewUrl,
  source,
  id,
  children,
}: {
  kind: "folder" | "file";
  /** Unique within the list (folder id or source|id). */
  rowKey: string;
  /** Folder navigation target — used on DOUBLE click. */
  href?: string;
  /** File preview target — opened in a new tab on double click. */
  previewUrl?: string;
  source?: string;
  id?: string;
  children: ReactNode;
}) {
  const rows = useContext(Ctx);
  const selection = useFileSelection();
  const router = useRouter();

  const fileKey = source && id ? selectionKey(source, id) : null;
  const isSelected =
    kind === "folder"
      ? rows?.selectedFolder === rowKey
      : !!fileKey && !!selection?.selected.has(fileKey);

  function open() {
    if (kind === "folder" && href) {
      router.push(href);
    } else if (kind === "file" && previewUrl) {
      window.open(previewUrl, "_blank", "noopener");
    }
  }

  function onClick(e: ReactMouseEvent) {
    // Row controls (menus, checkboxes, the From link) own their clicks.
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input, [role=menuitem], [role=checkbox]")) return;
    e.stopPropagation();
    if (kind === "folder") {
      rows?.setSelectedFolder(isSelected ? null : rowKey);
      selection?.clear();
    } else if (fileKey && selection) {
      // Plain click behaves like Drive: selects THIS row (add with the
      // checkbox or Ctrl/Cmd-click for more).
      if (e.ctrlKey || e.metaKey) {
        selection.toggle(fileKey);
      } else if (selection.selected.has(fileKey) && selection.selected.size === 1) {
        selection.clear();
      } else {
        selection.clear();
        selection.toggle(fileKey);
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
        rows?.setSelectedFolder(isSelected ? null : rowKey);
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
      tabIndex={0}
      role="button"
      className={cn(
        "cursor-default select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // Drive's blue. The row's own hover (a translucent gray) paints over
        // it, which reads as "selected, hovered" — close enough to Drive.
        isSelected && "bg-accent/15",
      )}
      data-selected={isSelected || undefined}
    >
      {children}
    </div>
  );
}
