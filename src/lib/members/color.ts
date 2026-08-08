// ONE COLOUR PER TEAMMATE, everywhere in the product.
//
// Founder: "across the entire software, when mentioning someone ensure there's
// colour to it, every member on the team has a distinct colour."
//
// This module is that colour's single source of truth. It did not start here —
// the identical palette and hash already lived in lib/engagements/presence.ts
// (the live faces on an engagement), with two more private copies in team-chat
// and the messages tab. Three implementations of "this person's colour" is
// three answers to one question, so the presence one — the only one built on
// the app's own tokens and tuned for both themes — was promoted here and the
// others now delegate. presenceColor() remains as an alias so no call site had
// to change.
//
// THE TOKENS, not new colours: each --icon-* is already defined for light AND
// dark in globals.css, so a name stays legible on both without a second palette
// to maintain. Rose is deliberately absent — it reads as an error state
// everywhere else in this app, and a teammate's name is not a warning.

export const MEMBER_COLORS = [
  "icon-blue",
  "icon-emerald",
  "icon-purple",
  "icon-amber",
  "icon-cyan",
  "icon-indigo",
] as const;

export type MemberColor = (typeof MEMBER_COLORS)[number];

/**
 * Stable per-person colour, derived from the user id — so the same teammate is
 * the same colour on every screen, in every session, for every viewer. A colour
 * that shuffled on reload would be worse than no colour at all.
 *
 * A plain sum of char codes is deliberate: uuids differ in far more than one
 * position, the palette is tiny, and a cryptographic hash would buy nothing but
 * a dependency. Never negative, so the modulo is safe.
 */
export function memberColor(userId: string): MemberColor {
  let sum = 0;
  for (let i = 0; i < userId.length; i++) sum += userId.charCodeAt(i);
  return MEMBER_COLORS[sum % MEMBER_COLORS.length]!;
}

/** The CSS colour value, for `style` props (presence rings, dots). */
export function memberColorVar(userId: string): string {
  return `var(--${memberColor(userId)})`;
}

/** The Tailwind TEXT class, for a name rendered in running text. Listed in
 *  full rather than built by template so Tailwind's scanner keeps them all. */
const TEXT_CLASS: Record<MemberColor, string> = {
  "icon-blue": "text-icon-blue",
  "icon-emerald": "text-icon-emerald",
  "icon-purple": "text-icon-purple",
  "icon-amber": "text-icon-amber",
  "icon-cyan": "text-icon-cyan",
  "icon-indigo": "text-icon-indigo",
};

export function memberTextClass(userId: string): string {
  return TEXT_CLASS[memberColor(userId)];
}
