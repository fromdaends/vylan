// ONE COLOUR PER TEAMMATE, everywhere in the product.
//
// Founder: "across the entire software, when mentioning someone ensure there's
// colour to it, every member on the team has a distinct colour."
//
// ── "DISTINCT" IS THE HARD WORD, AND A BARE HASH DOES NOT DELIVER IT ───────
//
// A hash into a small palette collides constantly — with six colours, two of
// five teammates share one about half the time (birthdays). So there are two
// layers here:
//
//   memberColor(id)      — the stable, roster-free answer. Same person, same
//                          colour, forever, computed from nothing but their id.
//                          This is what presence rings use, where the component
//                          holds one person and no list.
//   memberColorMap(list) — the DISTINCT answer, for any surface that holds the
//                          roster. Everyone keeps their hashed colour unless it
//                          is already taken, in which case the later id (sorted,
//                          so the outcome never depends on array order) steps to
//                          the next free one. Adding a teammate can only move
//                          somebody who actually collides with them; everyone
//                          else keeps the colour they have always had.
//
// ── THE TOKENS ─────────────────────────────────────────────────────────────
//
// --member-* in globals.css, defined for light AND dark. They are NOT the
// --icon-* hues these started as: those are tuned for icon fills, and several
// (amber worst) sit near 3:1 on white, under WCAG AA for 13px text. The member
// set is the same hue family pulled down to L .45-.48 in light mode. Rose is
// absent on purpose — it reads as an error state everywhere else in this app,
// and a teammate's name is not a warning.

export const MEMBER_COLORS = [
  "member-blue",
  "member-emerald",
  "member-purple",
  "member-amber",
  "member-cyan",
  "member-indigo",
  "member-teal",
  "member-magenta",
] as const;

export type MemberColor = (typeof MEMBER_COLORS)[number];

/**
 * The stable per-person colour, from the id alone — so the same teammate is the
 * same colour in every session and for every viewer. A colour that shuffled on
 * reload would be worse than no colour at all.
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

/**
 * Distinct colours across a known roster. Hash first, then resolve collisions
 * in id order so the result is identical for every viewer and every render.
 * Past the palette size, colours necessarily repeat — the map still returns a
 * colour for everyone rather than leaving anybody unpainted.
 */
export function memberColorMap(
  members: readonly { id: string }[],
): Map<string, MemberColor> {
  const out = new Map<string, MemberColor>();
  const taken = new Set<MemberColor>();
  // Sorted, so two components holding the same people in different orders
  // still agree.
  const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const m of ordered) {
    const wanted = memberColor(m.id);
    if (!taken.has(wanted)) {
      out.set(m.id, wanted);
      taken.add(wanted);
      continue;
    }
    // Walk forward from the hashed slot, so a member's fallback is still
    // derived from their own id rather than from their position in the list.
    const start = MEMBER_COLORS.indexOf(wanted);
    let picked: MemberColor | null = null;
    for (let step = 1; step < MEMBER_COLORS.length; step++) {
      const candidate = MEMBER_COLORS[(start + step) % MEMBER_COLORS.length]!;
      if (!taken.has(candidate)) {
        picked = candidate;
        break;
      }
    }
    // Palette exhausted (more teammates than colours): keep the hashed colour
    // and accept the repeat.
    const final = picked ?? wanted;
    out.set(m.id, final);
    taken.add(final);
  }
  return out;
}

/** The CSS colour value, for `style` props (presence rings, dots). */
export function memberColorVar(userId: string): string {
  return `var(--${memberColor(userId)})`;
}

/** The Tailwind TEXT class. Listed in full rather than built by template so
 *  Tailwind's scanner keeps every one of them. */
const TEXT_CLASS: Record<MemberColor, string> = {
  "member-blue": "text-member-blue",
  "member-emerald": "text-member-emerald",
  "member-purple": "text-member-purple",
  "member-amber": "text-member-amber",
  "member-cyan": "text-member-cyan",
  "member-indigo": "text-member-indigo",
  "member-teal": "text-member-teal",
  "member-magenta": "text-member-magenta",
};

export function memberTextClass(color: MemberColor): string {
  return TEXT_CLASS[color];
}
