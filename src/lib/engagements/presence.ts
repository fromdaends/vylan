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

// ── COLOUR ───────────────────────────────────────────────────────────────────
//
// Every person gets a stable colour, the way Google Docs and Figma give each
// collaborator one. It is what turns a row of grey circles into "oh, Sarah's in
// here" recognisable at a glance without reading anything.
//
// These are the app's OWN icon tokens, not new colours: each is already tuned
// separately for light and dark mode in globals.css, so the ring stays legible
// on both without a second palette to maintain. Rose is left out — it reads as
// an error state everywhere else in this app, and "someone is looking at this"
// is not a warning.
export const PRESENCE_COLORS = [
  "icon-blue",
  "icon-emerald",
  "icon-purple",
  "icon-amber",
  "icon-cyan",
  "icon-indigo",
] as const;

export type PresenceColor = (typeof PRESENCE_COLORS)[number];

// Stable per-person colour. Derived from the id, so the same person is the same
// colour on every engagement, in every session, for every viewer — a colour that
// shuffled on reload would be worse than no colour at all.
//
// A plain sum of char codes is deliberate: uuids differ in far more than one
// position, the palette is tiny, and a cryptographic hash here would buy nothing
// but a dependency. Never negative, so the modulo is safe.
export function presenceColor(userId: string): PresenceColor {
  let sum = 0;
  for (let i = 0; i < userId.length; i++) sum += userId.charCodeAt(i);
  return PRESENCE_COLORS[sum % PRESENCE_COLORS.length];
}
