"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { bulkMoveDocumentsAction } from "@/app/actions/documents";
import {
  moveBucketToFolderAction,
  moveFolderAction,
  setDocumentsFolderAction,
} from "@/app/actions/folders";
import { parseSelectionKey, selectionKey, useFileSelection } from "./file-selection";
import { hideDragGhost, showDragGhost } from "./drag-ghost";

// DRAG AND DROP — moving things by dragging them, the way every file manager
// works. Files AND folders: grabbing any row and dropping it on a folder moves
// it there.
//
// Uses the browser's native drag-and-drop rather than a library: rows are
// server-rendered, the payload is a handful of ids, and the native API already
// gives keyboard-accessible fallbacks through the menus that exist alongside it.
//
// FOLDERS WERE THE GAP. Only file rows were ever draggable, so grabbing a folder
// did nothing — and a screen showing only folders (a year view, or a client with
// its documents already filed) had nothing draggable on it at all. "When I hold
// on Bookkeeping & business, I can't move it anywhere" was an exact description
// of that screen, not a bug in the drop side.
//
// Three things can be dragged, and each means the obvious thing:
//
//   a FILE, or a whole selection → onto any folder
//   a CUSTOM FOLDER              → into another folder, or onto an ancestor in
//                                  the path bar to move it back up
//   a YEAR or CATEGORY folder    → onto a custom folder. Those are COMPUTED from
//                                  the documents inside them — there is no row
//                                  to re-parent — so the drag moves their
//                                  CONTENTS. Refusing the gesture outright would
//                                  be indistinguishable from the app being
//                                  broken, which is exactly what it looked like.
//
// EVERY FOLDER IS ALSO A DROP TARGET, including the derived ones. Dropping a
// file on a custom folder files it there; on "2023" sets its year; on
// "Bookkeeping" sets its category. That uniformity is the whole point — "like
// Google Drive" means the gesture works wherever a folder appears.

// TWO mime types, not one, and the difference matters.
//
// During a drag the browser refuses to let you READ the payload — only its list
// of types — so the type is the only thing a row can use to decide whether it
// should light up. Documents can be dropped on any folder; a folder or a whole
// year can only be dropped on a real folder. Encoding that in the type is what
// lets an invalid target stay dark and show a "no drop" cursor instead of
// inviting the drop and then rejecting it with an error toast.
const MIME_DOCS = "application/x-vylan-documents";
const MIME_MOVE = "application/x-vylan-foldermove";

/** What a folder row does when something is dropped ON it. */
export type DropTarget =
  | { kind: "folder"; folderId: string | null }
  | { kind: "year"; year: number | null }
  | { kind: "category"; category: string | null };

/** What is being dragged. */
export type DragPayload =
  | { kind: "documents"; items: { source: string; id: string }[] }
  | { kind: "folder"; clientId: string; folderId: string }
  | {
      kind: "bucket";
      clientId: string;
      year?: number | null;
      yearSet?: boolean;
      category?: string | null;
      categorySet?: boolean;
    };

function startDrag(e: React.DragEvent, payload: DragPayload, label: string) {
  const mime = payload.kind === "documents" ? MIME_DOCS : MIME_MOVE;
  e.dataTransfer.setData(mime, JSON.stringify(payload));
  // Plain text too, so dropping outside the app degrades to something harmless
  // and legible instead of nothing.
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "move";
}

/**
 * A drop that lands NOWHERE must still answer.
 *
 * The invalid targets deliberately stay dark and refuse the drop — but from
 * the person dragging, a gesture that ends in silence is indistinguishable
 * from the feature being broken. This is not hypothetical: on a client with
 * no custom folders, every row on screen is a derived year, so there is
 * nothing valid to drop on at all, and the founder's report of that screen
 * was "nothing actually moves when you drop things in places."
 *
 * `dropEffect` is how the browser tells the SOURCE how its drag ended:
 * "move" when a target accepted it, "none" when nothing did (invalid target,
 * empty space, Escape). On "none" we say what happened and what to do
 * instead — which for a year folder is the one thing the UI cannot show:
 * that years are automatic, and organizing by hand needs a folder of yours.
 */
function explainDeadDrop(e: React.DragEvent, key: string, t: (k: string) => string) {
  if (e.dataTransfer && e.dataTransfer.dropEffect === "none") {
    toast.info(t(key));
  }
}

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
  const t = useTranslations("Files");
  const selection = useFileSelection();
  const [dragging, setDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Dragging a row that is part of a multi-selection drags the WHOLE
        // selection — dragging one of five ticked files and moving only that
        // one is the behaviour people file bug reports about.
        const key = selectionKey(source, id);
        const selected = selection?.selected;
        const items =
          selected && selected.size > 0 && selected.has(key)
            ? [...selected].map(parseSelectionKey)
            : [{ source, id }];
        startDrag(e, { kind: "documents", items }, name);
        showDragGhost({ event: e, label: name, kind: "file", count: items.length });
        setDragging(true);
      }}
      onDragEnd={(e) => {
        hideDragGhost();
        setDragging(false);
        explainDeadDrop(e, "drag_dead_file", t);
      }}
      className={cn("transition-opacity", dragging && "opacity-40")}
    >
      {children}
    </div>
  );
}

/**
 * A draggable folder row.
 *
 * `moves` says what dragging THIS folder means: re-parent a real folder, or
 * relocate the contents of a computed one. Null means the folder cannot move
 * (a client row has nowhere to go), and then the row is not draggable at all
 * rather than draggable-but-inert.
 */
export function DraggableFolder({
  moves,
  name,
  children,
}: {
  moves: DragPayload | null;
  name: string;
  children: ReactNode;
}) {
  const t = useTranslations("Files");
  const [dragging, setDragging] = useState(false);
  if (!moves) return <>{children}</>;
  // A derived year needs different guidance than a folder the firm made:
  // "put it in another folder" is useless advice when the row you grabbed is
  // automatic and the screen has no folders yet.
  const deadKey = moves.kind === "bucket" ? "drag_dead_bucket" : "drag_dead_folder";

  return (
    <div
      draggable
      onDragStart={(e) => {
        // A folder row is a link, and the browser's own link-drag would
        // otherwise win and drag a URL instead of the folder.
        e.stopPropagation();
        startDrag(e, moves, name);
        showDragGhost({ event: e, label: name, kind: "folder", count: 1 });
        setDragging(true);
      }}
      onDragEnd={(e) => {
        hideDragGhost();
        setDragging(false);
        explainDeadDrop(e, deadKey, t);
      }}
      className={cn("transition-opacity", dragging && "opacity-40")}
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

  /** Whether this row can take what is currently being carried. */
  function accepts(e: React.DragEvent): boolean {
    const types = e.dataTransfer.types;
    if (types.includes(MIME_DOCS)) return true;
    // A folder, or a whole year's worth of documents — needs a real folder to
    // land in. Years and categories are computed, so nothing can move "into"
    // one.
    if (types.includes(MIME_MOVE)) return target.kind === "folder";
    return false;
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    // Also here, not only on dragend: a successful drop refreshes the list, and
    // if the row you dragged is re-rendered away its dragend never arrives —
    // leaving the chip stuck to the cursor.
    hideDragGhost();

    const raw =
      e.dataTransfer.getData(MIME_DOCS) || e.dataTransfer.getData(MIME_MOVE);
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object" || !("kind" in payload)) return;

    startTransition(async () => {
      // ── a folder dropped on a folder: re-parent it ──────────────────────
      if (payload.kind === "folder") {
        if (target.kind !== "folder") {
          // A real folder has no meaning inside a computed year or category.
          toast.error(t("drop_folder_not_allowed"));
          return;
        }
        if (target.folderId === payload.folderId) return; // onto itself
        const moved = await moveFolderAction({
          clientId: payload.clientId,
          folderId: payload.folderId,
          newParentId: target.folderId,
        });
        if (!moved.ok) {
          // "cycle" gets its own message: "a folder can't go inside itself"
          // tells you what to do, "that didn't work" does not.
          toast.error(
            moved.error === "cycle"
              ? t("folder_cycle")
              : moved.error === "name_taken"
                ? t("folder_name_taken")
                : t("action_failed"),
          );
          return;
        }
        router.refresh();
        toast.success(t("folder_moved_to", { name: label }));
        return;
      }

      // ── everything else moves documents ─────────────────────────────────
      let res: { ok: boolean; succeeded: number; failed: number; skipped: number };

      if (payload.kind === "bucket") {
        if (target.kind !== "folder") {
          toast.error(t("drop_folder_not_allowed"));
          return;
        }
        res = await moveBucketToFolderAction({
          clientId: payload.clientId,
          year: payload.year,
          yearSet: payload.yearSet,
          category: payload.category,
          categorySet: payload.categorySet,
          folderId: target.folderId,
        });
      } else {
        if (payload.items.length === 0) return;
        res =
          target.kind === "folder"
            ? await setDocumentsFolderAction({
                targets: payload.items,
                folderId: target.folderId,
              })
            : await bulkMoveDocumentsAction({
                targets: payload.items,
                // "unsorted" is a real destination, not the absence of one —
                // the Unsorted folder has to be droppable like any other.
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
      }

      selection?.clear();
      router.refresh();
      // Report what actually happened. Anything that claims a move over a
      // screen that did not change reads as the app being broken — which is
      // exactly how "14 files moved" landed when all 14 were already there.
      if (res.failed > 0 && res.succeeded > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.failed > 0) {
        toast.error(t("action_failed"));
      } else if (res.succeeded > 0) {
        toast.success(t("drop_done", { count: res.succeeded, folder: label }));
      } else if (res.skipped > 0) {
        toast.info(t("drop_already_there", { folder: label }));
      } else {
        toast.info(t("drop_nothing"));
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
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragEnter={(e) => {
        if (accepts(e)) e.preventDefault();
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
