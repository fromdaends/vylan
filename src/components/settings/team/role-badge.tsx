// A firm role, worn.
//
// Small, quiet, and the same everywhere a name appears — a badge that looks
// different on the roster than on a profile stops reading as an identity and
// starts reading as decoration.

import { roleColorClasses, roleSwatchClass } from "@/lib/roles/palette";

export function RoleBadge({
  name,
  color,
}: {
  name: string;
  color: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${roleColorClasses(color)}`}
    >
      {/* The dot carries the colour at full strength. The pill's tint alone is
          10% and reads as grey at this size on some displays. */}
      <span
        className={`size-1.5 shrink-0 rounded-full ${roleSwatchClass(color)}`}
        aria-hidden
      />
      {name}
    </span>
  );
}

/** Someone's roles in a row. Renders nothing at all when they have none —
 *  an empty gap beside a name is worse than no element. */
export function RoleBadges({
  roles,
  className = "",
}: {
  roles: { id: string; name: string; color: string }[];
  className?: string;
}) {
  if (roles.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {roles.map((r) => (
        <RoleBadge key={r.id} name={r.name} color={r.color} />
      ))}
    </span>
  );
}
