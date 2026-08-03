// The colours a firm role can be.
//
// A FIXED LIST, NOT A HEX PICKER, and that is the whole design decision here.
// A free colour field means somebody eventually picks #FFFF00, which is
// invisible on the light theme, or #101010, which vanishes on the dark one —
// and a badge nobody can read is worse than no badge. Eight names, each with a
// pair that has been checked against both grounds.
//
// The DATABASE STORES THE NAME ("blue"), never the hex. A stored hex freezes
// today's palette into every row: restyle the app and every existing badge is
// suddenly the old colours. A stored name is a reference, so a future theme
// change moves every badge with it.
//
// Unknown names fall back to slate rather than throwing. A role coloured by a
// newer build must still render in an older one — during a rollout both are
// live at once.

export const ROLE_COLORS = [
  "slate",
  "blue",
  "violet",
  "emerald",
  "amber",
  "rose",
  "cyan",
  "orange",
] as const;

export type RoleColor = (typeof ROLE_COLORS)[number];

export const DEFAULT_ROLE_COLOR: RoleColor = "slate";

export function isRoleColor(v: unknown): v is RoleColor {
  return typeof v === "string" && (ROLE_COLORS as readonly string[]).includes(v);
}

/** Anything unrecognised reads as the default rather than breaking a page. */
export function toRoleColor(v: unknown): RoleColor {
  return isRoleColor(v) ? v : DEFAULT_ROLE_COLOR;
}

// Tailwind classes per colour: a tinted background, readable text, and a hairline
// ring. Written as complete literal strings because Tailwind scans source for
// class names — building them by interpolation (`bg-${color}-500/10`) produces
// classes that exist in the markup and not in the stylesheet, which is the
// classic way a dynamic palette ships looking unstyled.
const CLASSES: Record<RoleColor, string> = {
  slate:
    "bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300",
  blue: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  violet:
    "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  emerald:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  amber: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  rose: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  cyan: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  orange:
    "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
};

export function roleColorClasses(color: unknown): string {
  return CLASSES[toRoleColor(color)];
}

// The solid swatch used in the colour picker, where there is no text to carry
// the colour and a 10% tint would read as eight shades of grey.
const SWATCHES: Record<RoleColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  orange: "bg-orange-500",
};

export function roleSwatchClass(color: unknown): string {
  return SWATCHES[toRoleColor(color)];
}

// A role name is a badge, not a paragraph. Long enough for "Senior reviewer",
// short enough that a roster row cannot be pushed off screen by one.
export const ROLE_NAME_MAX = 32;

export function normalizeRoleName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Collapse whitespace so " Manager " and "Manager" are the same role rather
  // than two that look identical in the list.
  const name = raw.trim().replace(/\s+/g, " ").slice(0, ROLE_NAME_MAX);
  return name || null;
}
