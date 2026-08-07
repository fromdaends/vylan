"use client";

// The capacity board: who is carrying what, and what can move.
//
// ── DRAG IS ONE WRITER, NOT THE WRITER ─────────────────────────────────────
//
// The workflow engine reassigns engagements by itself — `effects.ts` rewrites
// `assigned_user_id` when a job enters a stage with a different owner. So a
// card can change column while nobody is touching the board, and this component
// must READ assignment from the rows it is given rather than treat its own
// local state as the truth. That is why the optimistic overlay below is keyed
// by id and cleared as soon as fresh rows arrive: the board proposes, the
// server decides, and the engine gets the last word.
//
// (That rule came from the session that built the engine, written down for this
// one. Ignoring it would mean a board that quietly reverts a stage handoff.)
//
// ── WHY POINTER EVENTS AND NOT HTML5 DnD ───────────────────────────────────
//
// HTML5 drag-and-drop cannot render a custom drag image that tilts, cannot
// animate the drop, and on Windows shows a ghost the browser owns. The handoff
// asks for a specific feel — 2.5° tilt, spring landing — so the drag is
// pointer-based: pointerdown arms it, 4px of movement starts it (a shorter
// threshold and a click becomes a drag), and window listeners carry it so
// leaving the card does not drop it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import {
  dropIndexFor,
  rankForDrop,
  sortColumn,
} from "@/lib/engagements/board-rank";
import { moveEngagementCardAction } from "@/app/actions/engagement-board";
import { BoardCard, type BoardCardData } from "./board-card";

/** The id used for the column of jobs nobody owns. Not a uuid, so it can never
 *  collide with a real member. */
const UNASSIGNED = "__unassigned__";

/** Movement before a press becomes a drag. Below this it is still a click. */
const DRAG_THRESHOLD_PX = 4;

type Overlay = { assigneeId: string | null; boardRank: number | null };

type DragState = {
  cardId: string;
  /** Where in the card the pointer grabbed it, so the ghost sits under the
   *  same spot rather than snapping its corner to the cursor. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  pointerX: number;
  pointerY: number;
  targetColumnId: string;
  targetIndex: number;
  /** Set on drop, while the ghost springs home. */
  landing: { left: number; top: number } | null;
};

export function CapacityBoard({
  cards,
  members,
  locale,
  today,
  canReassign,
  showBudget,
  showEmptyColumns,
  animate,
  labels,
  statusLabel,
}: {
  cards: BoardCardData[];
  members: { id: string; name: string }[];
  locale: AppLocale;
  today: string;
  /** Team mode off = a read-only board. Cards still render; nothing drags. */
  canReassign: boolean;
  showBudget: boolean;
  showEmptyColumns: boolean;
  /** First paint, and motion allowed. */
  animate: boolean;
  labels: {
    unassigned: string;
    dragHere: string;
    moveFailed: string;
    card: React.ComponentProps<typeof BoardCard>["labels"];
  };
  /** Localizes a derived status into the word on the pill. Passed in so the
   *  board shares the list's vocabulary instead of starting a second one. */
  statusLabel: (derivedStatus: string) => string;
}) {
  const router = useRouter();
  /** Set from the effect below, so the drag listeners always call the current
   *  commit without depending on it. */
  const commitRef = useRef<() => void>(() => {});
  // Optimistic positions, keyed by engagement id. Empty in the steady state —
  // an entry exists only between a drop and the server agreeing with it.
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const wellRefs = useRef(new Map<string, HTMLDivElement>());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  // Fresh rows from the server supersede every optimistic guess — including the
  // engine's own reassignments, which this board never made and must not undo.
  //
  // Adjusted DURING RENDER, not in an effect. An effect would paint the stale
  // board once and correct it a frame later, which looks exactly like the card
  // you just dropped snapping back to where it came from.
  const [seenCards, setSeenCards] = useState(cards);
  if (seenCards !== cards) {
    setSeenCards(cards);
    setOverlay({});
  }

  const columns = useMemo(() => {
    const at = (c: BoardCardData) =>
      overlay[c.row.id]?.assigneeId !== undefined
        ? overlay[c.row.id].assigneeId
        : c.row.assigneeUserId;
    const rankOf = (c: BoardCardData) =>
      overlay[c.row.id]?.boardRank !== undefined
        ? overlay[c.row.id].boardRank
        : c.boardRank;

    const byColumn = new Map<string, BoardCardData[]>();
    for (const m of members) byColumn.set(m.id, []);
    byColumn.set(UNASSIGNED, []);
    for (const c of cards) {
      const key = at(c) ?? UNASSIGNED;
      // A card assigned to somebody who is no longer an active member would
      // otherwise vanish from the board entirely. It lands in Unassigned,
      // which is true enough to act on.
      if (!byColumn.has(key)) byColumn.set(key, []);
      byColumn.get(key)!.push(c);
    }

    const ordered = [
      ...members.map((m) => ({ id: m.id, name: m.name })),
      // Unassigned LAST, per the handoff — it is the overflow, not a person.
      { id: UNASSIGNED, name: labels.unassigned },
    ];
    return ordered
      .map((col) => ({
        ...col,
        cards: sortColumn(
          (byColumn.get(col.id) ?? []).map((c) => ({
            ...c,
            id: c.row.id,
            boardRank: rankOf(c),
          })),
        ),
      }))
      .filter(
        (col) =>
          showEmptyColumns || col.cards.length > 0 || col.id === UNASSIGNED,
      );
  }, [cards, members, overlay, showEmptyColumns, labels.unassigned]);

  // ── THE DRAG ────────────────────────────────────────────────────────────

  // Click vs drag: the browser fires a CLICK on the same element after every
  // pointerup, including the one that ends a drag — so a card would navigate
  // away the moment you dropped it somewhere. Armed drags flip this ref, the
  // click handler checks it, and a fresh pointerdown clears it. For people
  // who cannot reassign, startDrag returns before any of the drag machinery,
  // the ref stays false, and every click is a clean open.
  const suppressClickRef = useRef(false);

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cardId: string) => {
      suppressClickRef.current = false;
      if (!canReassign || e.button !== 0) return;
      const el = cardRefs.current.get(cardId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      let armed = false;

      const onMove = (ev: PointerEvent) => {
        if (
          !armed &&
          Math.hypot(ev.clientX - startX, ev.clientY - startY) <
            DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (!armed) {
          armed = true;
          suppressClickRef.current = true;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
        }
        setDrag((prev) => {
          const base: DragState = prev ?? {
            cardId,
            offsetX: startX - rect.left,
            offsetY: startY - rect.top,
            width: rect.width,
            height: rect.height,
            pointerX: ev.clientX,
            pointerY: ev.clientY,
            targetColumnId: UNASSIGNED,
            targetIndex: 0,
            landing: null,
          };
          const target = resolveTarget(
            ev.clientX,
            ev.clientY,
            cardId,
            wellRefs.current,
          );
          return {
            ...base,
            pointerX: ev.clientX,
            pointerY: ev.clientY,
            targetColumnId: target?.columnId ?? base.targetColumnId,
            targetIndex: target?.index ?? base.targetIndex,
          };
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Through a ref: `commit` is declared below, and a listener that
        // captured it directly would either be a use-before-declare or would
        // pin the first render's copy for the life of the drag.
        if (armed) commitRef.current();
        else setDrag(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // Cancel drops where it is, per the handoff — losing the card back to
      // its origin because a pen left the tablet would be worse.
      window.addEventListener("pointercancel", onUp);
    },
    [canReassign],
  );

  // Read through refs so the window listeners never close over a stale board
  // while a drag is in flight. Written in an EFFECT — assigning during render
  // is a side effect in a function React may call twice.
  const dragRef = useRef<DragState | null>(null);
  const columnsRef = useRef(columns);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const commit = useCallback(() => {
    const d = dragRef.current;
    if (!d) return setDrag(null);

    const cols = columnsRef.current;
    const card = cards.find((c) => c.row.id === d.cardId);
    const targetCol = cols.find((c) => c.id === d.targetColumnId);
    if (!card || !targetCol) return setDrag(null);

    const assigneeId = d.targetColumnId === UNASSIGNED ? null : d.targetColumnId;
    const reassigned = (card.row.assigneeUserId ?? null) !== assigneeId;
    // The dragged card cannot be its own neighbour — leaving it in would give
    // it back the rank it already had, and the drop would look like a no-op.
    const without = targetCol.cards.filter((c) => c.row.id !== d.cardId);
    const boardRank = rankForDrop(
      without.map((c) => ({ id: c.row.id, boardRank: c.boardRank })),
      d.targetIndex,
    );

    // The card is already where you dropped it. The write catches up.
    setOverlay((o) => ({ ...o, [d.cardId]: { assigneeId, boardRank } }));

    // Let the ghost spring to the placeholder before it disappears.
    const placeholder = wellRefs.current.get(d.targetColumnId);
    const rect = placeholder?.getBoundingClientRect();
    setDrag({ ...d, landing: rect ? { left: rect.left + 10, top: d.pointerY - d.offsetY } : null });
    window.setTimeout(() => setDrag(null), 240);

    void moveEngagementCardAction({
      engagementId: d.cardId,
      assigneeId,
      boardRank,
      reassigned,
    }).then((res) => {
      if (res.ok) return;
      // Put it back where the server says it is, and say so — a card that
      // silently returns to its old column reads as the board being broken.
      setOverlay((o) => {
        const next = { ...o };
        delete next[d.cardId];
        return next;
      });
      toast.error(labels.moveFailed);
      router.refresh();
    });
  }, [cards, labels.moveFailed, router]);

  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const dragged = drag ? cards.find((c) => c.row.id === drag.cardId) : null;

  return (
    <>
      <div className="-mx-8 flex items-start gap-4 overflow-x-auto px-8 pb-7 pt-1.5">
        {columns.map((col, colIndex) => (
          <BoardColumn
            key={col.id}
            name={col.name}
            count={col.cards.length}
            dragOver={drag?.targetColumnId === col.id}
            dragHereLabel={labels.dragHere}
            wellRef={(el) => {
              if (el) wellRefs.current.set(col.id, el);
              else wellRefs.current.delete(col.id);
            }}
          >
            {col.cards.map((c, rowIndex) => (
              <div key={c.row.id}>
                {/* The placeholder rides ABOVE the card it would displace. */}
                {drag?.targetColumnId === col.id &&
                  drag.targetIndex === rowIndex && (
                    <Placeholder height={drag.height} />
                  )}
                <div
                  ref={(el) => {
                    if (el) cardRefs.current.set(c.row.id, el);
                    else cardRefs.current.delete(c.row.id);
                  }}
                  data-board-card={c.row.id}
                  data-board-column={col.id}
                >
                  <BoardCard
                    data={c}
                    locale={locale}
                    today={today}
                    showBudget={showBudget}
                    labels={labels.card}
                    statusLabel={statusLabel(c.row.derivedStatus)}
                    dragging={drag?.cardId === c.row.id}
                    onPointerDown={(e) => startDrag(e, c.row.id)}
                    // The founder's missing click: a card opens its
                    // engagement. Never fires off the pointerup that ends a
                    // drag (the suppress ref above).
                    onOpen={() => {
                      if (suppressClickRef.current) return;
                      router.push(`/engagements/${c.row.id}`);
                    }}
                    entranceDelayMs={
                      animate ? 150 + colIndex * 70 + rowIndex * 65 : undefined
                    }
                  />
                </div>
              </div>
            ))}
            {/* ...and at the end when it is going last, including into an
                empty column, where index 0 is also the end. */}
            {drag?.targetColumnId === col.id &&
              drag.targetIndex >= col.cards.length && (
                <Placeholder height={drag.height} />
              )}
          </BoardColumn>
        ))}
      </div>

      {/* ── THE GHOST ──────────────────────────────────────────────────── */}
      {drag && dragged && (
        <div
          className={cn("board-ghost", drag.landing && "board-ghost-landing")}
          style={{
            width: drag.width,
            left: drag.landing?.left ?? drag.pointerX - drag.offsetX,
            top: drag.landing?.top ?? drag.pointerY - drag.offsetY,
          }}
        >
          <BoardCard
            data={dragged}
            locale={locale}
            today={today}
            showBudget={showBudget}
            labels={labels.card}
            statusLabel={statusLabel(dragged.row.derivedStatus)}
          />
        </div>
      )}
    </>
  );
}

function Placeholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      style={{ height }}
      className="mb-2.5 rounded-xl border-[1.5px] border-dashed border-accent/50 bg-accent/5"
    />
  );
}

function BoardColumn({
  name,
  count,
  dragOver,
  dragHereLabel,
  wellRef,
  children,
}: {
  name: string;
  count: number;
  dragOver: boolean;
  dragHereLabel: string;
  wellRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  // The badge pops when the number changes — but not on first render, where
  // every column would pop at once and the gesture would mean nothing.
  const [popping, setPopping] = useState(false);
  const [seenCount, setSeenCount] = useState(count);
  if (seenCount !== count) {
    setSeenCount(count);
    // Not on first render: every column would pop at once and the gesture
    // would stop meaning "this one just changed".
    setPopping(true);
  }
  useEffect(() => {
    if (!popping) return;
    const t = window.setTimeout(() => setPopping(false), 400);
    return () => window.clearTimeout(t);
  }, [popping]);

  const empty = count === 0;

  return (
    <div className="w-[292px] flex-none">
      <div className="flex items-center gap-2 px-0.5 pb-2">
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
          {name}
        </p>
        <span
          className={cn(
            "rounded-full bg-secondary px-2 py-px text-xs font-semibold tabular-nums text-foreground/70",
            popping && "board-badge-pop",
          )}
        >
          {count}
        </span>
      </div>

      <div
        ref={wellRef}
        className={cn(
          "relative min-h-[110px] rounded-[14px] bg-secondary/55 p-2.5",
          "flex flex-col gap-2.5",
        )}
      >
        {dragOver && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[14px] border-[1.5px] border-dashed border-accent/55 bg-accent/[0.04]"
          />
        )}
        {children}
        {empty && !dragOver && (
          <div className="rounded-xl border-[1.5px] border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            {dragHereLabel}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Which column the pointer is over, and where in it the card would land.
 *
 * The hit area is deliberately GENEROUS below the well (+160px): a column with
 * two cards in it is short, and dropping "at the bottom" means aiming at empty
 * page underneath. Without the slop the card snaps back to where it came from
 * and the board feels like it is refusing you.
 */
function resolveTarget(
  x: number,
  y: number,
  draggedId: string,
  wells: Map<string, HTMLDivElement>,
): { columnId: string; index: number } | null {
  for (const [columnId, well] of wells) {
    const r = well.getBoundingClientRect();
    if (x < r.left - 8 || x > r.right + 8) continue;
    if (y < r.top - 8 || y > r.bottom + 160) continue;

    const rects: { top: number; height: number }[] = [];
    for (const el of Array.from(
      well.querySelectorAll<HTMLElement>("[data-board-card]"),
    )) {
      if (el.dataset.boardCard === draggedId) continue;
      const cr = el.getBoundingClientRect();
      rects.push({ top: cr.top, height: cr.height });
    }
    return { columnId, index: dropIndexFor(rects, y) };
  }
  return null;
}
