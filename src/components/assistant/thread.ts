// Pure thread model for the chat tab: messages and action confirm-cards
// interleaved chronologically. Client-safe (no server imports) — the card
// type mirrors the wire shape of /api/engagement-chat/history's `actions`
// and the message stream's `action` events.

export type ActionCardStatus =
  | "proposed"
  | "confirming"
  | "confirmed"
  | "cancelled"
  | "failed"
  | "expired";

export type ActionCardData = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: ActionCardStatus;
  createdAt: string;
  expiresAt: string;
  error: string | null;
  // Present only on still-confirmable cards (the browser-held capability).
  token: string | null;
};

export type ThreadMessage = {
  kind: "message";
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ThreadAction = {
  kind: "action";
  action: ActionCardData;
};

export type ThreadItem = ThreadMessage | ThreadAction;

// Interleave persisted messages and action cards by creation time. A card is
// written between its user turn and the assistant turn that proposed it, so
// timestamp order reproduces the live layout; ties break message-first.
export function mergeThreadItems(
  messages: { role: "user" | "assistant"; content: string; createdAt: string }[],
  actions: ActionCardData[],
): ThreadItem[] {
  const out: ThreadItem[] = [];
  let m = 0;
  let a = 0;
  while (m < messages.length || a < actions.length) {
    const msg = messages[m];
    const act = actions[a];
    if (msg && (!act || msg.createdAt <= act.createdAt)) {
      out.push({
        kind: "message",
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      });
      m++;
    } else if (act) {
      out.push({ kind: "action", action: act });
      a++;
    }
  }
  return out;
}
