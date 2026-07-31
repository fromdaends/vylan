"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { bulkMoveDocumentsAction } from "@/app/actions/documents";
import {
  materializeBucketTargetAction,
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

/** What a folder row does when something is dropped ON it. Derived targets
 * carry their DISPLAY NAMES because dropping a folder on one materializes it
 * — the server needs to know what to call the real folder it creates. */
export type DropTarget =
  | { kind: "folder"; folderId: string | null }
  | { kind: "year"; year: number | null; label: string }
  | {
      kind: "category";
      category: string | null;
      label: string;
      /** The year view this category row sits inside, so materializing it can
       * scaffold the real year folder around it ("2025/Bookkeeping"). */
      year?: number | null;
      yearSet?: boolean;
      yearLabel?: string;
    };

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
      /** The derived folder's display name ("2026", "Bookkeeping & business").
       * Dropping the bucket NESTS it: a real folder with this name is created
       * at the destination and the files go inside that — so the name must
       * travel with the drag. */
      label: string;
    };

// ── THE DRAG IN FLIGHT ──────────────────────────────────────────────────────
// The drop target and the drag source are different components, but a finished
// move needs both: the target runs the server action, and the SOURCE ROW is
// the thing that must disappear. Waiting for the page refresh to remove it
// leaves a second or two where the screen still shows the old world — which,
// after a toast has already said "Moved", reads as the move not working. This
// is same-window drag and drop, so a module-level handshake is enough:
//
//   dragstart   the source registers itself here and dims
//   drop        the target grabs it, runs the action, then answers:
//                 hide()    → the move really happened; the row vanishes NOW
//                 release() → nothing changed (no-op, error); the row undims
//   dragend     if no target accepted the drop, the source cleans itself up
//
// The refresh still runs and remains the source of truth — hide() just closes
// the gap between the database changing and the screen admitting it.
type ActiveDrag = { hide: () => void; release: () => void };
let activeDrag: ActiveDrag | null = null;
function grabDrag(): ActiveDrag | null {
  const d = activeDrag;
  activeDrag = null;
  return d;
}

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
  const [hidden, setHidden] = useState(false);

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
        activeDrag = {
          hide: () => setHidden(true),
          release: () => setDragging(false),
        };
        setDragging(true);
      }}
      onDragEnd={(e) => {
        hideDragGhost();
        if (e.dataTransfer && e.dataTransfer.dropEffect !== "none") {
          // A target accepted the drop. STAY dimmed until its action reports
          // back — hide on success, undim on no-op or error. Flashing back to
          // full opacity for a beat and then vanishing reads as a glitch. The
          // timeout is the escape hatch if the drop handler dies unanswered.
          window.setTimeout(() => setDragging(false), 10_000);
          return;
        }
        activeDrag = null;
        setDragging(false);
        explainDeadDrop(e, "drag_dead_file", t);
      }}
      className={cn("transition-opacity", dragging && "opacity-40", hidden && "hidden")}
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
  const [hidden, setHidden] = useState(false);
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
        activeDrag = {
          hide: () => setHidden(true),
          release: () => setDragging(false),
        };
        setDragging(true);
      }}
      onDragEnd={(e) => {
        hideDragGhost();
        if (e.dataTransfer && e.dataTransfer.dropEffect !== "none") {
          // Accepted somewhere — stay dimmed until the drop's action answers.
          window.setTimeout(() => setDragging(false), 10_000);
          return;
        }
        activeDrag = null;
        setDragging(false);
        explainDeadDrop(e, deadKey, t);
      }}
      className={cn("transition-opacity", dragging && "opacity-40", hidden && "hidden")}
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
    // Documents AND folders land on anything folder-shaped. Derived targets
    // (a year, a category) MATERIALIZE on drop — see onDrop — so there is no
    // longer a folder-shaped row that refuses a folder-shaped thing. "I can
    // drop 2026 into Bookkeeping & business but not Bookkeeping & business
    // into 2026" was the review of the old asymmetry, and it was correct.
    return types.includes(MIME_DOCS) || types.includes(MIME_MOVE);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    // Also here, not only on dragend: a successful drop refreshes the list, and
    // if the row you dragged is re-rendered away its dragend never arrives —
    // leaving the chip stuck to the cursor.
    hideDragGhost();
    // The source row, waiting to be told whether it still lives here. EVERY
    // exit below must answer it: hide() when the move really happened,
    // release() when nothing changed — a path that forgets leaves the row
    // dimmed for ten seconds.
    const drag = grabDrag();

    const raw =
      e.dataTransfer.getData(MIME_DOCS) || e.dataTransfer.getData(MIME_MOVE);
    if (!raw) {
      drag?.release();
      return;
    }
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      drag?.release();
      return;
    }
    if (!payload || typeof payload !== "object" || !("kind" in payload)) {
      drag?.release();
      return;
    }

    // The truthful ending shared by every document-moving path: the row
    // vanishes the moment the database confirms a real change, undims when
    // nothing changed, and the toast reports exactly which of those happened.
    function settle(
      res: { ok: boolean; succeeded: number; failed: number; skipped: number },
      success: string,
    ) {
      selection?.clear();
      if (res.succeeded > 0) drag?.hide();
      else drag?.release();
      router.refresh();
      if (res.failed > 0 && res.succeeded > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.failed > 0) {
        toast.error(t("action_failed"));
      } else if (res.succeeded > 0) {
        toast.success(success);
      } else if (res.skipped > 0) {
        toast.info(t("drop_already_there", { folder: label }));
      } else {
        toast.info(t("drop_nothing"));
      }
    }

    startTransition(async () => {
      // ── documents: file into a real folder, or set the axis on a derived
      //    one. No materialization needed — a file dropped on "2026" IS
      //    inside 2026 when you open it; the derived view answers by
      //    attribute ─────────────────────────────────────────────────────
      if (payload.kind === "documents") {
        if (payload.items.length === 0) {
          drag?.release();
          return;
        }
        const res =
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
        settle(res, t("drop_done", { count: res.succeeded, folder: label }));
        return;
      }

      // ── a folder, or a whole derived folder: the destination must be a
      //    REAL folder, so a derived target MATERIALIZES first — the same
      //    rule as dragging one: touching it makes it real. Dropping onto
      //    "2026" turns 2026 into a real folder (absorbing its unfiled
      //    documents) and the dragged thing lands INSIDE it ───────────────
      let destId: string | null;
      if (target.kind === "folder") {
        destId = target.folderId;
      } else {
        const made = await materializeBucketTargetAction(
          target.kind === "year"
            ? {
                clientId: payload.clientId,
                year: target.year,
                yearSet: true,
                yearName: target.label,
              }
            : {
                clientId: payload.clientId,
                year: target.year,
                yearSet: target.yearSet,
                yearName: target.yearLabel,
                category: target.category,
                categorySet: true,
                categoryName: target.label,
              },
        );
        if (!made.ok || !made.folderId) {
          drag?.release();
          toast.error(t("action_failed"));
          return;
        }
        destId = made.folderId;
      }

      // ── a folder: re-parent it into the destination ─────────────────────
      if (payload.kind === "folder") {
        if (destId === payload.folderId) {
          drag?.release();
          return; // onto itself
        }
        const moved = await moveFolderAction({
          clientId: payload.clientId,
          folderId: payload.folderId,
          newParentId: destId,
        });
        if (!moved.ok) {
          // "cycle" gets its own message: "a folder can't go inside itself"
          // tells you what to do, "that didn't work" does not.
          drag?.release();
          toast.error(
            moved.error === "cycle"
              ? t("folder_cycle")
              : moved.error === "name_taken"
                ? t("folder_name_taken")
                : t("action_failed"),
          );
          return;
        }
        if (moved.noop) {
          // It was already exactly there. Saying "Moved" over an unchanged
          // screen is the lie this feature kept relapsing into.
          drag?.release();
          toast.info(t("drop_already_there", { folder: label }));
          return;
        }
        drag?.hide();
        router.refresh();
        toast.success(t("folder_moved_to", { name: label }));
        return;
      }

      // ── a derived folder: nest it inside the destination. The toast names
      //    the thing that was dragged ("Moved 2026 into Taxes"), not a file
      //    count — the person dragged a FOLDER ──────────────────────────────
      const res = await moveBucketToFolderAction({
        clientId: payload.clientId,
        year: payload.year,
        yearSet: payload.yearSet,
        category: payload.category,
        categorySet: payload.categorySet,
        folderId: destId,
        bucketName: payload.label,
      });
      settle(res, t("drop_nested", { name: payload.label, folder: label }));
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
