"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { bulkMoveDocumentsAction } from "@/app/actions/documents";
import { setDocumentsFolderAction } from "@/app/actions/folders";
import { parseSelectionKey, selectionKey, useFileSelection } from "./file-selection";

// DRAG AND DROP — moving files by dragging them onto a folder, the way every
// file manager works.
//
// Uses the browser's native drag-and-drop rather than a library: rows are
// server-rendered, the payload is a handful of ids, and the native API already
// gives keyboard-accessible fallbacks through the menus that exist alongside it.
// A drag library would be a dependency to hold up a feature this small.
//
// EVERY FOLDER IS A DROP TARGET, including the derived ones. Dropping a file on
// a custom folder files it there; dropping it on "2023" sets its year; dropping
// it on "Bookkeeping" sets its category. That uniformity is the whole point —
// "like Google Drive" means the gesture works wherever a folder appears, not
// only on the folders that happen to be rows in a table.

const MIME = "application/x-vylan-documents";

/** What a folder row does when something is dropped on it. */
export type DropTarget =
  | { kind: "folder"; folderId: string | null }
  | { kind: "year"; year: number | null }
  | { kind: "category"; category: string | null };

type Payload = { source: string; id: string }[];

export function DraggableFile({
  source,
  id,
  name,
  children,
}: {
  source: string;
  id: string;
  name: string;
  children: ReactNode;
}) {
  const selection = useFileSelection();
  const [dragging, setDragging] = useState(false);

  function onDragStart(e: React.DragEvent) {
    // Dragging a row that is part of a multi-selection drags the WHOLE
    // selection — dragging one of five ticked files and moving only that one
    // is the behaviour people file bug reports about.
    const key = selectionKey(source, id);
    const selected = selection?.selected;
    const payload: Payload =
      selected && selected.size > 0 && selected.has(key)
        ? [...selected].map(parseSelectionKey)
        : [{ source, id }];

    e.dataTransfer.setData(MIME, JSON.stringify(payload));
    // Plain text too, so dropping outside the app degrades to something
    // harmless and legible instead of nothing.
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      className={cn(dragging && "opacity-40")}
    >
      {children}
    </div>
  );
}

export function FolderDropTarget({
  target,
  label,
  children,
}: {
  target: DropTarget;
  /** The folder's name, for the confirmation message. */
  label: string;
  children: ReactNode;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const selection = useFileSelection();
  const [over, setOver] = useState(false);
  const [, startTransition] = useTransition();

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) return;
    let payload: Payload;
    try {
      payload = JSON.parse(raw) as Payload;
    } catch {
      return;
    }
    if (!Array.isArray(payload) || payload.length === 0) return;

    startTransition(async () => {
      const res =
        target.kind === "folder"
          ? await setDocumentsFolderAction({
              targets: payload,
              folderId: target.folderId,
            })
          : await bulkMoveDocumentsAction({
              targets: payload,
              // "unsorted" is a real destination, not the absence of one — the
              // Unsorted folder has to be droppable like any other.
              year:
                target.kind === "year"
                  ? target.year == null
                    ? "unsorted"
                    : String(target.year)
                  : undefined,
              category:
                target.kind === "category"
                  ? (target.category ?? "unsorted")
                  : undefined,
            });

      selection?.clear();
      router.refresh();
      if (res.failed > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.ok) {
        toast.success(t("drop_done", { count: res.succeeded, folder: label }));
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  return (
    <div
      onDragOver={(e) => {
        // preventDefault on BOTH dragover and dragenter is what actually makes
        // an element a drop target in the HTML drag-and-drop API. Omit it and
        // the drop silently never fires — the single most common way this API
        // is got wrong.
        if (!e.dataTransfer.types.includes(MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(MIME)) e.preventDefault();
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "rounded-lg transition-colors",
        // A ring rather than a background change: the row already highlights on
        // hover, and a second background would be ambiguous about which of the
        // two states you are looking at.
        over && "ring-2 ring-inset ring-accent",
      )}
    >
      {children}
    </div>
  );
}
