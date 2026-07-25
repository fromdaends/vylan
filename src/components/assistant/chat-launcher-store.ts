// Module-level store for the global chat popup launcher (bottom-right),
// shared between the launcher itself (mounted once in the app layout) and the
// app surfaces that open it — the profile "Help" menu, notification "reply"
// rows, and the ?panel deep-link. Same useSyncExternalStore pattern as the
// sidebar-collapse preference; no context provider, no prop drilling.
//
// This replaces the old always-docked assistant panel + its assistant-store.
// The popup has two modes (Client messages / Vylan AI) and can EXPAND messaging
// into a docked, resizable sidebar (opt-in, not the old default panel).

export type ChatMode = "messages" | "ai";

export type ChatLauncherState = {
  // The compact bottom-right popup is open.
  open: boolean;
  // Which mode the popup (or the expanded sidebar) shows.
  mode: ChatMode;
  // Messaging is expanded into the docked, resizable Instagram-style sidebar.
  // Mutually exclusive with the compact popup: expanding closes the popup.
  expanded: boolean;
};

let state: ChatLauncherState = {
  open: false,
  mode: "messages",
  expanded: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeChatLauncher(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getChatLauncherState(): ChatLauncherState {
  return state;
}

// useSyncExternalStore requires a referentially-stable server snapshot.
const SERVER_SNAPSHOT: ChatLauncherState = {
  open: false,
  mode: "messages",
  expanded: false,
};

export function getChatLauncherServerSnapshot(): ChatLauncherState {
  return SERVER_SNAPSHOT;
}

// Open the popup. Opening always leaves the expanded sidebar (they're mutually
// exclusive surfaces on the same bottom-right anchor).
export function openChat(mode?: ChatMode) {
  state = {
    ...state,
    open: true,
    expanded: false,
    mode: mode ?? state.mode,
  };
  emit();
}

// Convenience openers used by the app's entry points.
export function openMessages() {
  openChat("messages");
}
export function openAi() {
  openChat("ai");
}

export function closeChat() {
  state = { ...state, open: false };
  emit();
}

export function setChatMode(mode: ChatMode) {
  state = { ...state, mode };
  emit();
}

// Expand messaging into the docked resizable sidebar: closes the popup and
// forces messages mode (the AI stays a popup-only surface, per the spec).
export function expandMessages() {
  state = { ...state, open: false, expanded: true, mode: "messages" };
  emit();
}

// Collapse the docked sidebar back to nothing (the FAB reappears).
export function collapseMessages() {
  state = { ...state, expanded: false };
  emit();
}
