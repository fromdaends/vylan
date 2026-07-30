"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

// A number field you can actually EMPTY while typing.
//
// THE BUG THIS EXISTS FOR (founder, 2026-07-30): "doesn't let me change custom
// reminders from 1 ... I can't erase the 1 and type in another number." Every
// reminder day/repeat box was written as
//
//   value={step.days}
//   onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
//
// Select the "1", press Backspace: the field's value is "", Number("") is 0,
// `0 || 1` is 1 — so the state never leaves 1, the controlled input instantly
// repaints "1", and the caret lands after it. Type "4" and you get "14". There
// is NO keystroke sequence that reaches 4. The clamp meant to keep the value
// sane made the field impossible to edit.
//
// The fix is to let the TEXT be whatever the user is mid-way through typing —
// including empty — and only clamp when they have finished. The committed value
// is still never out of range, so callers keep the guarantee they had.
export function clampToRange(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  // BLANK IS CHECKED FIRST, AND SEPARATELY, because `Number("")` is 0 — not
  // NaN. Leaning on Number() alone sends an empty box through Math.max(min, 0)
  // and straight back to the minimum, which is the very bug this component
  // exists to fix. (Caught by its own test; the trap is easy to walk into
  // twice.)
  if (raw.trim() === "") return fallback;
  const n = Math.floor(Number(raw));
  // "abc" / NaN → keep what the caller already had rather than snapping to a
  // bound. Snapping is what made the old field fight back.
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function ClampedNumberInput({
  value,
  min,
  max,
  onCommit,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  /** Called with an in-range integer, never with an empty or partial value. */
  onCommit: (next: number) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  // The raw text. Diverges from `value` only while the user is mid-edit.
  const [draft, setDraft] = useState(() => String(value));
  const [seenValue, setSeenValue] = useState(value);

  // Adopt an OUTSIDE change (switching reminder preset, resetting the form)
  // without clobbering what is being typed: if the draft already represents the
  // committed value, leave the text exactly as it is — that is what preserves
  // an empty box between the Backspace and the next digit.
  //
  // Adjusted DURING RENDER rather than in an effect. This is React's documented
  // recipe for "a prop changed and some state should follow it" — React reruns
  // this component before touching the DOM, so there is no flash and no second
  // commit. An effect would also trip the repo's react-hooks lint, which is
  // right to complain: an effect here means rendering one value and then
  // immediately replacing it.
  if (value !== seenValue) {
    setSeenValue(value);
    if (clampToRange(draft, min, max, value) !== value) setDraft(String(value));
  }

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        // An empty (or half-typed) box commits nothing — the last good value
        // stands until there is a real number to replace it with.
        if (next.trim() === "") return;
        onCommit(clampToRange(next, min, max, value));
      }}
      onBlur={() => {
        // Leaving the field settles it: an empty or out-of-range box becomes
        // the clamped number it actually stored.
        const settled = clampToRange(draft, min, max, value);
        setDraft(String(settled));
        onCommit(settled);
      }}
    />
  );
}
