"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setMemberPermissions } from "@/app/actions/team";
import { GRANTABLE_CAPABILITIES } from "@/lib/auth/grantable";
import { capabilityLabelKey } from "@/lib/auth/capability-labels";
import type { Capability } from "@/lib/auth/capabilities";
import { roleTextClass } from "@/lib/roles/palette";

// USER ACCESS — what one person is allowed to do, and WHERE EACH PIECE CAME
// FROM.
//
// It lives on the PERSON'S OWN PAGE, tucked into the left rail, because that is
// where the founder asked for it: "there should be a little profile page where
// you can view that person's profile ... and the permission switches should
// exist inside that page, like hidden away." Not a permissions screen, not a
// column on the roster — a quiet panel on the object it acts on.
//
// ── THE MEMBER / JUNIOR SWITCH IS GONE ───────────────────────────────────────
//
// This panel used to open with a segmented Member / Junior control. The founder
// deleted it: "there shouldn't be two ways of having permissions ... permissions
// should exist purely based off roles that is created by the owner." The same
// two switches appeared here AND on a role, either could grant, and neither
// screen told you which one had.
//
// So ROLES are the switchboard now, and this panel does two things instead:
//
//   1. Says what this person already gets FROM A ROLE, and names the role. That
//      is the question an owner actually arrives with — "why can she do that?"
//      — and it had no answer anywhere in the app before.
//   2. Keeps ONE per-person override, for the case where you want to hand one
//      person one thing without inventing a role for them.
//
// A capability a role already grants shows its source and its switch is DEAD,
// not merely on: turning it off here would promise a revocation this model
// cannot express (grants only ever add), and a switch that lies is worse than a
// switch that is honest about being decided elsewhere.
//
// ── WHAT IS DELIBERATELY NOT OFFERED ─────────────────────────────────────────
//
// Only capabilities that are (a) actually enforced on the server today and
// (b) safe to hold without being an owner appear here. The rest are excluded on
// purpose, each for its own reason:
//
//   team.manage      — NOT RLS-backed. Every write in actions/team.ts uses the
//                      service-role client, and the invites SELECT policy is
//                      literally owner-only, so a granted non-owner would get a
//                      management screen with a permanently empty invite list.
//   clients.private  — decided by RLS (engagement_is_private, 0810). Granting it
//                      in application code would change what the UI renders and
//                      nothing about what the database returns. A switch that
//                      does not work is worse than no switch.
//   audit.view       — the founder's call, twice: history is owner-only.
//   firm.settings    — firm-wide policy (privacy defaults, AI, documents). Not
//                      per-person by nature; if a firm wants it delegated, that
//                      is a co-owner, not a switch.
//   time.approve     — Phase 8. The capability exists; the feature does not.
const GRANTABLE = GRANTABLE_CAPABILITIES;

export function MemberPermissions({
  userId,
  grants,
  /** The roles this person wears that carry capabilities, so the panel can name
   *  the source instead of showing an unexplained switch. */
  fromRoles = [],
  disabled = false,
}: {
  userId: string;
  grants: readonly string[] | null | undefined;
  fromRoles?: { name: string; color: string; capabilities: string[] }[];
  // Migration 1120 not applied yet, or a deactivated teammate.
  disabled?: boolean;
}) {
  const t = useTranslations("Team");
  // The transition is still what carries the save (and keeps the route's
  // revalidation from blocking paint); its `pending` flag is deliberately
  // unread — nothing on this panel should grey out while it runs.
  const [, start] = useTransition();
  const [extra, setExtra] = useState<string[]>(() => [...(grants ?? [])]);

  const save = (nextExtra: string[]) => {
    // Optimistic, then reverted on failure — the alternative is a switch that
    // visibly lags every click by a round-trip.
    const prev = extra;
    setExtra(nextExtra);
    start(async () => {
      const res = await setMemberPermissions(userId, nextExtra);
      if (res.ok) return;
      setExtra(prev);
      toast.error(
        res.error === "unavailable"
          ? t("permissions_unavailable")
          : t("permissions_failed"),
      );
    });
  };

  // One shared key mapper (capability-labels.ts) — this was a local ternary,
  // duplicated in roles-workbench, and both would have mislabeled every
  // capability added after the first two.
  const label = (cap: Capability) => t(capabilityLabelKey(cap));

  // Which role grants what. First role wins the attribution — naming all of
  // them turns a one-line answer into a list nobody reads.
  const grantedBy = new Map<string, { name: string; color: string }>();
  for (const r of fromRoles) {
    for (const c of r.capabilities) {
      if (!grantedBy.has(c)) grantedBy.set(c, { name: r.name, color: r.color });
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("permissions_roles_first")}
      </p>

      <div className="space-y-2.5 border-t border-border/50 pt-3">
        {GRANTABLE.map((cap) => {
          const source = grantedBy.get(cap);
          const on = source != null || extra.includes(cap);
          return (
            <div key={cap} className="space-y-0.5">
              <label className="flex items-start justify-between gap-3 text-xs">
                <span className="leading-snug text-foreground">
                  {label(cap)}
                </span>
                <Switch
                  checked={on}
                  // Decided by the role, so this switch reports rather than
                  // sets. See the note at the top.
                  disabled={disabled || source != null}
                  ariaLabel={label(cap)}
                  onCheckedChange={(next) =>
                    save(next ? [...extra, cap] : extra.filter((c) => c !== cap))
                  }
                />
              </label>
              {source && (
                <p className="text-[11px] text-muted-foreground">
                  {t("permissions_from_role")}{" "}
                  <span className={roleTextClass(source.color)}>
                    {source.name}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
