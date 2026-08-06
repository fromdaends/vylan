// Due dates, as the task lists reason about them.
//
// Lifted out of tasks-table.tsx when the card view arrived: two surfaces
// rendering the same date two ways is the drift the cohesion rule exists to
// stop, and the alternative — the table exporting them and the card importing
// from the table — would have been a circular import.
//
// PLAIN module: no "use client", no server imports. Both a client card and a
// server page can ask it.

/** Today, in the LOCAL calendar, as the same YYYY-MM-DD string a due date is
 *  stored in — so "overdue" is a string comparison and never a timezone bug. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Rendered from the parts, never `new Date(str)`: a bare YYYY-MM-DD is parsed
 *  as UTC midnight, which prints as the day BEFORE for anyone west of London. */
export function formatDue(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/** Late is STRICTLY before today, and only while there is still work to do —
 *  a finished task that was late is history, not a thing to chase. Due today is
 *  today's work, and colouring it red is how a list teaches people to ignore
 *  red. */
export function isOverdue(
  dueDate: string | null | undefined,
  status: string,
  now = today(),
): boolean {
  return Boolean(dueDate && status !== "done" && dueDate < now);
}
