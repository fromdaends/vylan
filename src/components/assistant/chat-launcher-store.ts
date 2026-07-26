// Module-level store for the global chat popup launcher (bottom-right),
// shared between the launcher itself (mounted once in the app layout) and the
// app surfaces that open it — the profile "Help" menu, notification "reply"
// rows, and the ?panel deep-link. Same useSyncExternalStore pattern as the
// sidebar-collapse preference; no context provider, no prop drilling.
//
// This replaces the old always-docked assistant panel + its assistant-store.
// The popup has two modes (Client messages / Vylan AI) and can EXPAND messaging
// into a docked, resizable sidebar (opt-in, not the old default panel).

// "team" is the firm's internal team chat. Unlike the other two it is NOT a
// permanent mode: it only exists while the Team page is mounted (that page sets
// teamChatAvailable and opens the launcher on it). Leave the page and the mode
// disappears — the launcher falls back to the AI.
export type ChatMode = "messages" | "ai" | "team";

export type ChatLauncherState = {
  // The compact bottom-right popup is open.
  open: boolean;
  // Which mode the popup (or the expanded sidebar) shows.
  mode: ChatMode;
  // Messaging is expanded into the docked, resizable Instagram-style sidebar.
  // Mutually exclusive with the compact popup: expanding closes the popup.
  expanded: boolean;
  // True only while the Team page is mounted — what makes the "team" mode exist.
  teamChatAvailable: boolean;
};

// Opens on the Vylan AI by default (founder): the AI is the "ask anything"
// front door, and it's the mode that carries the greeting. Messages is one tap
// away, and the toggle remembers your last choice while you stay on the page.
let state: ChatLauncherState = {
  open: false,
  mode: "ai",
  expanded: false,
  teamChatAvailable: false,
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
  mode: "ai",
  expanded: false,
  teamChatAvailable: false,
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

// The Team page publishes/retracts the team chat's availability as it mounts and
// unmounts. On retract, a launcher sitting on the team mode falls back to the AI
// so it can never strand on a mode that no longer exists.
export function setTeamChatAvailable(available: boolean) {
  state = {
    ...state,
    teamChatAvailable: available,
    mode: !available && state.mode === "team" ? "ai" : state.mode,
  };
  emit();
}

// Open the popup straight into the firm's team chat (the Team page's button).
export function openTeamChat() {
  state = {
    ...state,
    open: true,
    expanded: false,
    teamChatAvailable: true,
    mode: "team",
  };
  emit();
}
