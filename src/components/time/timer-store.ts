// The timer dock's tiny cross-component store — the chat-launcher-store
// pattern, for the same reason: the "start a timer" button inside the chat
// panel's header and the dock that OWNS the ask-on-start sheet are far apart
// in the tree, and threading a callback through the launcher's dynamic import
// would couple two features that merely stand next to each other.
//
// One verb: openStartSheet(). The dock subscribes; anything may call.

type Listener = () => void;

let openRequests = 0;
const listeners = new Set<Listener>();

export function openStartSheet(): void {
  openRequests += 1;
  for (const l of listeners) l();
}

export function subscribeTimer(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic counter — the dock effects on changes, so two open requests in a
 *  row both register even when the sheet was already open. */
export function getTimerOpenRequests(): number {
  return openRequests;
}

export function getTimerServerSnapshot(): number {
  return 0;
}
