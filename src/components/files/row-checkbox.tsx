"use client";

import { selectionKey, useFileSelection } from "./file-selection";

// One file row's checkbox. A client island inside a server-rendered row.
//
// Deliberately a plain <input type="checkbox">: it is a checkbox, the browser
// already knows how to make it keyboard-operable and announce its state, and a
// custom control here would buy styling in exchange for accessibility work
// nobody would remember to do.
export function RowCheckbox({
  source,
  id,
  label,
}: {
  source: string;
  id: string;
  /** The file name, so screen readers announce WHICH file is being selected. */
  label: string;
}) {
  const selection = useFileSelection();
  if (!selection) return null;
  const key = selectionKey(source, id);
  return (
    <input
      type="checkbox"
      checked={selection.selected.has(key)}
      onChange={() => selection.toggle(key)}
      aria-label={label}
      className="size-4 shrink-0 cursor-pointer accent-accent"
      // The row is not a link, but the name inside it can be — stop a click on
      // the box from also triggering whatever is underneath.
      onClick={(e) => e.stopPropagation()}
    />
  );
}
