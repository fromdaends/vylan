"use client";

// A money field you can actually type into.
//
// ── THE BUG THIS EXISTS TO KILL ────────────────────────────────────────────
//
// Two screens held the rate as CENTS in state and rendered
// `(cents / 100).toFixed(2)` straight back into the input on every render. That
// looks reasonable and is unusable:
//
//   type "4"    -> 400 cents -> the box rewrites itself to "4.00", caret at end
//   type "0"    -> "4.000"   -> 4 dollars   -> rewrites to "4.00"
//   type "0"    -> "4.000"   -> 4 dollars   -> rewrites to "4.00"
//
// You cannot enter four hundred dollars. Every digit after the first is eaten
// by the reformat. Found by typing "400" into the service builder on production
// and watching $4.00 appear in the preview beside it.
//
// ── THE FIX ────────────────────────────────────────────────────────────────
//
// The text you are typing belongs to the input until you leave it. This keeps
// your raw keystrokes in local state, reports cents upward as you go so live
// previews still follow along, and only tidies the display to two decimals on
// blur. Cents stay the single source of truth for everything downstream; the
// string is just what is under the cursor.
//
// ── WHY IT IS SHARED ───────────────────────────────────────────────────────
//
// The same bug existed in the service builder and the engagement items editor,
// written on different days, because "a money field" was a pattern rather than
// a component. It is a component now, so the next one to need it cannot get it
// wrong a third time.

import { useState } from "react";
import { Input } from "@/components/ui/input";

/** Cents from typed text. Null for blank — "not priced" is a real answer, and
 *  0 would offer the work free. */
export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (cleaned === "") return null;

  // Parsed from the DIGITS, not by multiplying a float. `1.005 * 100` is
  // 100.49999999999999 in binary floating point, so Math.round gives 100 and a
  // cent quietly disappears. Money is integer cents in this repo precisely so
  // that cannot happen; the parser has to hold the same line.
  const [whole = "", frac = ""] = cleaned.split(".");
  if (whole === "" && frac === "") return null;

  const dollars = whole === "" ? 0 : Number(whole);
  if (!Number.isFinite(dollars)) return null;

  // Two decimal places, padded, with the third digit deciding the rounding.
  const cents = Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  const roundUp = Number(frac[2] ?? "0") >= 5;

  return dollars * 100 + cents + (roundUp ? 1 : 0);
}

export function MoneyInput({
  valueCents,
  onChangeCents,
  placeholder,
  id,
  className,
  ariaLabel,
}: {
  valueCents: number | null;
  onChangeCents: (cents: number | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() =>
    valueCents == null ? "" : (valueCents / 100).toFixed(2),
  );
  const [focused, setFocused] = useState(false);

  // Follow the value when it changes from OUTSIDE — picking a service fills the
  // rate in, and the box has to show it. Never while focused: that is the loop
  // this component exists to break.
  //
  // Adjusted DURING RENDER rather than in an effect. React sanctions setting
  // state during a component's own render for exactly this ("adjusting state
  // when a prop changes"), it re-renders before touching the DOM so there is no
  // flash — and the React Compiler rejects setState inside an effect outright.
  const [lastSeenCents, setLastSeenCents] = useState(valueCents);
  if (!focused && valueCents !== lastSeenCents) {
    setLastSeenCents(valueCents);
    setText(valueCents == null ? "" : (valueCents / 100).toFixed(2));
  }

  return (
    <Input
      id={id}
      className={className}
      aria-label={ariaLabel}
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        // Reported as you type, so a live preview follows the keystrokes — it
        // is only the DISPLAY that waits for blur.
        onChangeCents(parseMoneyToCents(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        const cents = parseMoneyToCents(text);
        setText(cents == null ? "" : (cents / 100).toFixed(2));
        onChangeCents(cents);
      }}
    />
  );
}
