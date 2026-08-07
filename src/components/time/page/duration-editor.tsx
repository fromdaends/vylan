"use client";

// Click a duration, retype it, press Enter.
//
// ── WHY THE PARSER IS NOT IN HERE ──────────────────────────────────────────
//
// `parseDurationToMinutes` already exists and the log-time dialog already uses
// it. Writing a second parser for this box would mean "2" meaning two hours in
// one control and two minutes in another, on the same screen — the founder's
// ruling when the handoff and the shipped parser disagreed: keep one parser,
// bare number is HOURS. It also folds the French comma ("1,5"), which the
// handoff never mentions and half this product's users type.
//
// ── OPTIMISTIC, AND SILENT WHEN IT FAILS TO PARSE ──────────────────────────
//
// The handoff: "invalid input reverts silently". So an unreadable value simply
// puts the old number back — no toast, no red border. You typed something that
// was not a duration; the box says so by not changing. A failed SAVE is
// different and does speak up, because that is the app's problem, not yours.

import { useEffect, useRef, useState } from "react";
import { parseDurationToMinutes, formatMinutes } from "@/lib/time/duration";
import { cn } from "@/lib/cn";

export function DurationEditor({
  minutes,
  onCommit,
  label,
  className,
}: {
  minutes: number;
  /** Returns false when the write failed, so the box can put the old value
   *  back. Resolved AFTER the optimistic number is already on screen. */
  onCommit: (nextMinutes: number) => Promise<boolean>;
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // What is drawn. Diverges from `minutes` only between an optimistic commit
  // and the server agreeing with it.
  const [shown, setShown] = useState(minutes);
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh value from the server supersedes the optimistic one. Adjusted
  // during render rather than in an effect: an effect paints the stale number
  // once and corrects it a frame later, which reads as the value flickering
  // back to what you just changed it from.
  const [seen, setSeen] = useState(minutes);
  if (seen !== minutes) {
    setSeen(minutes);
    setShown(minutes);
  }

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Selected, not just focused — the whole point of clicking a duration is
    // to replace it, and making people clear it first is a keystroke tax.
    el.select();
  }, [editing]);

  function open() {
    setDraft(formatMinutes(shown));
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const parsed = parseDurationToMinutes(draft);
    // Unreadable, or unchanged. Either way there is nothing to write.
    if (parsed == null || parsed === shown) return;
    const previous = shown;
    setShown(parsed);
    const ok = await onCommit(parsed);
    if (!ok) setShown(previous);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={label}
        className={cn(
          "cursor-text whitespace-nowrap text-xs font-semibold tabular-nums",
          "underline decoration-dashed decoration-from-font underline-offset-2",
          "transition-colors duration-150 hover:text-accent",
          className,
        )}
      >
        {formatMinutes(shown)}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          // Esc abandons the edit outright — no parse, no write.
          setEditing(false);
        }
      }}
      aria-label={label}
      className="h-[22px] w-[62px] rounded-md border border-accent bg-background px-1.5 text-xs font-semibold tabular-nums outline-none"
    />
  );
}
