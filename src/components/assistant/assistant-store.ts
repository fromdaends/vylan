// Tiny module-level store for the Vylan Assistant panel, shared between the
// panel itself (mounted once in the app layout) and the pages that talk to it
// (the engagement detail page publishes its engagement so the panel can
// preselect it). Same useSyncExternalStore pattern as the sidebar-collapse
// preference in app-shell.tsx — no context provider, no prop drilling across
// the layout boundary.

export type AssistantTab = "messages" | "chat" | "activity";

// What an engagement page publishes about itself while mounted. The panel
// uses it to preselect the engagement and to decide the FAB badge.
export type PageEngagement = {
  id: string;
  title: string;
  clientName: string | null;
  status: string;
  createdAt: string;
  // Client messages the firm hasn't read yet (server-computed by the page).
  // Badges the FAB and the panel's Client-messages tab.
  messagesUnread?: number;
};

// An engagement as selectable in the panel's picker (also the payload shape
// of GET /api/engagement-chat/engagements).
export type EngagementOption = {
  id: string;
  title: string;
  status: string;
  clientName: string | null;
};

export type AssistantState = {
  open: boolean;
  tab: AssistantTab;
  pageEngagement: PageEngagement | null;
  // The engagement the panel is scoped to (drives the Activity tab; the Chat
  // tab starts using it in Phase 2).
  selected: EngagementOption | null;
  // Bumped to ask the Chat tab to reload its history — e.g. after a message was
  // appended out-of-band (pushing a document-check summary into the chat).
  chatReloadNonce: number;
};

let state: AssistantState = {
  open: false,
  tab: "chat",
  pageEngagement: null,
  selected: null,
  chatReloadNonce: 0,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeAssistant(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAssistantState(): AssistantState {
  return state;
}

// Stable object for the server snapshot — useSyncExternalStore requires the
// server snapshot to be referentially stable across calls.
const SERVER_SNAPSHOT: AssistantState = {
  open: false,
  tab: "chat",
  pageEngagement: null,
  selected: null,
  chatReloadNonce: 0,
};

export function getAssistantServerSnapshot(): AssistantState {
  return SERVER_SNAPSHOT;
}

export function openAssistant(tab?: AssistantTab) {
  // Preselect the current page's engagement on every closed → open
  // transition ("when opened from an engagement page, it preselects that
  // engagement"). A manual pick made while the panel stays open sticks.
  const preselect =
    !state.open && state.pageEngagement
      ? {
          id: state.pageEngagement.id,
          title: state.pageEngagement.title,
          status: state.pageEngagement.status,
          clientName: state.pageEngagement.clientName,
        }
      : state.selected;
  state = { ...state, open: true, tab: tab ?? state.tab, selected: preselect };
  emit();
}

// Open scoped to the CURRENT PAGE's engagement, even if the panel is already
// open on something else. Used by the engagement page's Activity triggers —
// the user clicked a control that says "this engagement's activity", so the
// selection must follow, unlike the generic openAssistant() preselect that
// only fires on a closed → open transition.
export function openAssistantOnPageEngagement(tab?: AssistantTab) {
  const pe = state.pageEngagement;
  const selected = pe
    ? {
        id: pe.id,
        title: pe.title,
        status: pe.status,
        clientName: pe.clientName,
      }
    : state.selected;
  state = { ...state, open: true, tab: tab ?? state.tab, selected };
  emit();
}

// Open in GENERAL chat — explicitly NOT scoped to any engagement. Used by the
// profile menu's "Help" (desktop dropdown + mobile account menu, both via the
// "vylan:open-help" event): asking for help means "help me with the software",
// not "help me with the engagement I happen to be sitting on". So this clears
// any previous selection instead of preselecting the current page's engagement
// the way openAssistant() does — and it clears it even when the panel is
// already open on an engagement.
export function openAssistantGeneral(tab?: AssistantTab) {
  state = { ...state, open: true, tab: tab ?? state.tab, selected: null };
  emit();
}

// Open scoped to an EXPLICIT engagement (e.g. a notification's Reply chip),
// regardless of what page we're on or what the panel had selected.
export function openAssistantForEngagement(
  option: EngagementOption,
  tab?: AssistantTab,
) {
  state = { ...state, open: true, tab: tab ?? state.tab, selected: option };
  emit();
}

export function closeAssistant() {
  state = { ...state, open: false };
  emit();
}

export function setAssistantTab(tab: AssistantTab) {
  state = { ...state, tab };
  emit();
}

export function setPageEngagement(engagement: PageEngagement | null) {
  state = { ...state, pageEngagement: engagement };
  emit();
}

export function setSelectedEngagement(option: EngagementOption | null) {
  state = { ...state, selected: option };
  emit();
}

// Ask the Chat tab to reload its conversation (a message was added out-of-band).
export function reloadChat() {
  state = { ...state, chatReloadNonce: state.chatReloadNonce + 1 };
  emit();
}
