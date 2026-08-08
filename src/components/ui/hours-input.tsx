"use client";

// An hours field you can actually type into.
//
// The sibling of MoneyInput, and it exists for the same two reasons.
//
// ── THE TYPING BUG ─────────────────────────────────────────────────────────
//
// Durations are stored in MINUTES (1790, 1820) and asked for in HOURS, because
// "6" is what an accountant says and "360" is what a database wants. Render the
// stored value straight back into the box on every keystroke and the field
// fights you: type "2", it becomes "2h"; type "." and the parse fails, so the
// box empties under the cursor. Exactly the bug MoneyInput was written to kill,
// one unit over. So the raw keystrokes live here until you leave the field,
// minutes are reported upward as you type, and only the DISPLAY waits for blur.
//
// ── ONE VOCABULARY FOR TIME ────────────────────────────────────────────────
//
// Parsing is parseDurationToMinutes — the timer's manual-entry parser, already
// tested. So "2", "2.5", "2,5", "2h30", "90m" and "1:30" all work here too, and
// an accountant who learned to type a duration once has learned it everywhere.
// The service builder previously carried its own hand-rolled `Number(x) * 60`,
// which accepted a bare number and nothing else; two ways to write a duration
// in one product is the drift this component removes.
//
// Blank stays NULL, never 0 — and note the parser returns null for "0" too,
// which is deliberate and matches the rule already written in the service
// builder: "nobody has timed this" and "this takes no time" are different
// claims, and only one of them is safe to add into a capacity board's totals.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatMinutes, parseDurationToMinutes } from "@/lib/time/duration";

export function HoursInput({
  valueMinutes,
  onChangeMinutes,
  placeholder,
  id,
  className,
  ariaLabel,
}: {
  valueMinutes: number | null;
  onChangeMinutes: (minutes: number | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  // formatMinutes for the display, and it ROUND-TRIPS through the parser by
  // design: "1h 30m" and "3h" both read back to the same minutes they came
  // from. So blurring and refocusing never changes the value underneath.
  const show = (m: number | null) => (m == null ? "" : formatMinutes(m));

  const [text, setText] = useState(() => show(valueMinutes));
  const [focused, setFocused] = useState(false);

  // Follow the value when it changes from OUTSIDE — picking a catalogue service
  // fills the hours in, and the box has to show it. Never while focused: that
  // is the loop this component exists to break.
  //
  // Adjusted DURING RENDER rather than in an effect, for the reason MoneyInput
  // spells out: React sanctions this for "adjusting state when a prop changes",
  // and the React Compiler rejects setState inside an effect outright.
  const [lastSeen, setLastSeen] = useState(valueMinutes);
  if (!focused && valueMinutes !== lastSeen) {
    setLastSeen(valueMinutes);
    setText(show(valueMinutes));
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
        onChangeMinutes(parseDurationToMinutes(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        const minutes = parseDurationToMinutes(text);
        // Tidy to the canonical rendering, so what is saved and what is on
        // screen can never disagree. An unreadable entry clears rather than
        // sitting there looking accepted.
        setText(show(minutes));
        onChangeMinutes(minutes);
        // NOTE: `lastSeen` is deliberately NOT advanced here.
        //
        // Advancing it says "the outside world now holds this value", and on
        // blur that is not yet true — the parent may not have re-rendered, and
        // some parents never echo the value back at all. The render-time
        // adjustment above would then see prop !== lastSeen, decide the value
        // changed from outside, and blank the box the instant you clicked away
        // from it. Found by the round-trip test below.
      }}
    />
  );
}
