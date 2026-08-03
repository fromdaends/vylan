"use client";

// Handing a role to one person, on that person's page.
//
// Beside their permissions, for the founder's standing reason: a control about
// somebody belongs on them, not on a firm-wide screen listing everybody. The
// roles themselves are made in Settings → Team → Settings; this only hands out
// what already exists, which is why an empty list points there rather than
// offering to create one here.

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RoleBadge } from "./role-badge";
import { setUserRoleAction } from "@/app/actions/firm-roles";

type Role = { id: string; name: string; color: string };

export function MemberRoles({
  userId,
  allRoles,
  heldIds,
  disabled = false,
}: {
  userId: string;
  allRoles: Role[];
  heldIds: string[];
  /** Migration 1260 not applied, or a deactivated teammate. */
  disabled?: boolean;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Optimistic: the badge lights up under the cursor and puts itself back if
  // the server disagrees. A toggle that waits for a round trip reads as broken.
  const [held, setHeld] = useState<Set<string>>(new Set(heldIds));
  const [busy, setBusy] = useState<string | null>(null);

  if (allRoles.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("roles_none_yet")}</p>;
  }

  async function toggle(roleId: string) {
    if (disabled || busy) return;
    const on = !held.has(roleId);
    setHeld((prev) => {
      const next = new Set(prev);
      if (on) next.add(roleId);
      else next.delete(roleId);
      return next;
    });
    setBusy(roleId);
    try {
      const res = await setUserRoleAction({ userId, roleId, on });
      if (!res.ok) {
        setHeld((prev) => {
          const next = new Set(prev);
          if (on) next.delete(roleId);
          else next.add(roleId);
          return next;
        });
        toast.error(
          res.needsMigration ? t("roles_needs_migration") : t("roles_failed"),
        );
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {allRoles.map((r) => {
        const on = held.has(r.id);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => toggle(r.id)}
            disabled={disabled}
            aria-pressed={on}
            className={`rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              on ? "" : "opacity-40 hover:opacity-70"
            } ${disabled ? "cursor-not-allowed" : ""}`}
          >
            <RoleBadge name={r.name} color={r.color} />
          </button>
        );
      })}
    </div>
  );
}
