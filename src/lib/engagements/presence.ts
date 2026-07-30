// Who else is looking at this engagement right now.
//
// PURE half of the live-presence facepile — the reducer that turns a raw
// Supabase Realtime presence state into the avatars to draw. Kept out of the
// component so the rules below are unit-testable without a socket, a browser,
// or a logged-in user.
//
// ── WHY THE ROSTER FILTER IS NOT OPTIONAL ────────────────────────────────────
//
// The channel is PUBLIC. It has to be: Supabase private channels need a real
// JWT, and this project authenticates the browser with a publishable `sb_` key
// (cookies are HttpOnly by design), so a private channel is rejected outright.
// A public channel means anyone holding that key — it ships in the client
// bundle — plus an engagement's uuid can join it and BROADCAST ANY PRESENCE KEY
// THEY LIKE.
//
// So a presence entry is a claim, never a fact. `presentOthers` only returns
// people who appear in the roster the SERVER rendered into the page, which is
// already RLS-scoped to the viewer's firm. An injected id resolves to nobody
// and is dropped. Do not "simplify" this by rendering the presence keys
// directly — that would let a stranger paint arbitrary names into a firm's UI.
//
// The payload carries an id and nothing else for the same reason: a public
// channel must never be handed a name, an email or an avatar URL.

export type PresenceRoster = readonly { id: string; name: string }[];

// The shape Supabase's presenceState() returns: key -> one meta per open tab.
// Typed loosely on purpose; we only ever read the keys.
export type RawPresenceState = Record<string, unknown>;

export type PresentPerson = { id: string; name: string };

// Everyone present EXCEPT the viewer, resolved to real people, in roster order.
//
// - The viewer is dropped. Google Docs, Figma and Notion all show you who ELSE
//   is here; your own face staring back is noise, and on a solo firm it would
//   mean the row never disappears.
// - Roster order, not arrival order, so the row does not reshuffle under the
//   cursor every time somebody opens a tab.
// - Multiple tabs collapse for free: Supabase groups metas under one key, so
//   keying presence by user id means two tabs are one avatar.
export function presentOthers(
  state: RawPresenceState | null | undefined,
  viewerId: string,
  roster: PresenceRoster,
): PresentPerson[] {
  if (!state) return [];
  const here = new Set(Object.keys(state));
  return roster
    .filter((m) => m.id !== viewerId && here.has(m.id))
    .map((m) => ({ id: m.id, name: m.name }));
}

// Split into the faces we draw and the count we fold into a "+N" chip.
//
// A cap exists because a busy engagement should not push the title off its
// line. Four is the number Google Docs and Figma settle on before overflowing;
// beyond that the faces stop being recognisable anyway and the count is the
// more useful signal.
export const PRESENCE_VISIBLE_MAX = 4;

export function splitPresence(
  people: PresentPerson[],
  max: number = PRESENCE_VISIBLE_MAX,
): { shown: PresentPerson[]; overflow: number } {
  if (people.length <= max) return { shown: people, overflow: 0 };
  // Show max-1 and let the chip carry the rest, so the chip never says "+1"
  // while a slot sits empty — "+2 more" next to 3 faces reads correctly, "+1
  // more" next to 4 when a 5th slot was available does not.
  const shown = people.slice(0, max - 1);
  return { shown, overflow: people.length - shown.length };
}
