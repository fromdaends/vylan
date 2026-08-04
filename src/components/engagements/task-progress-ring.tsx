// A task's progress, as the ring Canopy puts on its task workspace.
//
// Founder, sending the screenshots: "copy their UI and the actual process
// itself." Canopy's task page carries a "0% PROGRESS" ring beside the details.
//
// ── IT COUNTS SUBTASKS, AND ONLY SUBTASKS ──────────────────────────────────
//
// A task with no steps has nothing to measure, so it renders NOTHING rather
// than a 0% ring. That distinction matters: an empty ring on a task nobody has
// broken down reads as "started and got nowhere", which is a judgement about
// work that has not been planned yet. It is the same rule the engagements list
// follows for a job with no tasks, and the founder's own call there —
// "blank is not zero".
//
// ⚠️ NO TIME TRACKING. Canopy's workspace also shows "Total time: 00:00 |
// 03:00" and a timer per subtask row. The founder ruled that out of this
// rebuild: "dont do time tracking thatl come later as a whole feature." It is
// easy to copy in by accident while working from these screenshots — don't.
//
// Pure SVG, no library: two circles and a dash offset. A chart dependency for
// one ring would be a page-weight cost on every task panel.

export function TaskProgressRing({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  /** Already-localised, e.g. "PROGRESS". */
  label: string;
}) {
  if (total <= 0) return null;

  const pct = Math.round((done / total) * 100);
  // r=26 in a 64-box leaves room for the 6px stroke without clipping.
  const r = 26;
  const circumference = 2 * Math.PI * r;
  // A full ring at 100% and an empty one at 0% both fall out of this — no
  // special-casing, which is where an off-by-one in a gauge usually hides.
  const filled = (pct / 100) * circumference;

  return (
    <div
      className="flex shrink-0 flex-col items-center gap-1"
      role="img"
      aria-label={`${pct}% ${label}`}
    >
      <svg viewBox="0 0 64 64" className="size-16" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          className="stroke-muted"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          // Starts at twelve o'clock rather than three, which is where a ring
          // is read from.
          transform="rotate(-90 32 32)"
          strokeDasharray={`${filled} ${circumference}`}
          className="stroke-accent transition-[stroke-dasharray] duration-500"
        />
        <text
          x="32"
          y="36"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-semibold tabular-nums"
        >
          {pct}%
        </text>
      </svg>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
