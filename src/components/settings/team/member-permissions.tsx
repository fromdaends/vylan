"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { setMemberPermissions } from "@/app/actions/team";
import { GRANTABLE_CAPABILITIES } from "@/lib/auth/grantable";

// What one person is allowed to do — Phase 2's per-person switches.
//
// It lives on the PERSON'S OWN PAGE, tucked into the left rail, because that is
// where the founder asked for it: "there should be a little profile page where
// you can view that person's profile, by clicking on them from the people tab,
// and the permission switches should exist inside that page, like hidden away."
// Not a permissions screen, not a column on the roster — a quiet panel on the
// object it acts on.
//
// ── WHY A ROLE PLUS EXTRAS, RATHER THAN A WALL OF SWITCHES ───────────────────
//
// The role is the baseline; the switches below it are only ever ADDITIONS. That
// is not a simplification, it is the storage model made visible: a preset names
// a set, and extra_capabilities can only add to it. A UI that let you switch
// OFF something the role grants would be promising a revocation the database
// has nowhere to record — it would have to silently move the person to a
// different role, which is exactly the kind of clever that surprises people.
//
// So: pick Member or Junior, then optionally hand this one person something
// extra. Both halves are honest about what they write.
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
  preset,
  grants,
  disabled = false,
}: {
  userId: string;
  // Current stored preset. null / undefined = never set = Member, which is what
  // every existing row is and what capabilities.ts resolves it to.
  preset: string | null | undefined;
  grants: readonly string[] | null | undefined;
  // Migration 1120 not applied yet, or a deactivated teammate.
  disabled?: boolean;
}) {
  const t = useTranslations("Team");
  // The transition is still what carries the save (and keeps the route's
  // revalidation from blocking paint); its `pending` flag is deliberately
  // unread — nothing on this panel should grey out while it runs.
  const [, start] = useTransition();
  const [role, setRole] = useState<"member" | "junior">(
    preset === "junior" ? "junior" : "member",
  );
  const [extra, setExtra] = useState<string[]>(() => [...(grants ?? [])]);

  const save = (nextRole: "member" | "junior", nextExtra: string[]) => {
    // Optimistic, then reverted on failure — the alternative is a switch that
    // visibly lags every click by a round-trip.
    const prevRole = role;
    const prevExtra = extra;
    setRole(nextRole);
    setExtra(nextExtra);
    start(async () => {
      const res = await setMemberPermissions(userId, nextRole, nextExtra);
      if (res.ok) return;
      setRole(prevRole);
      setExtra(prevExtra);
      toast.error(
        res.error === "unavailable"
          ? t("permissions_unavailable")
          : t("permissions_failed"),
      );
    });
  };

  return (
    <div className="space-y-4">
      {/* The role. Two options, so a segmented pair rather than a dropdown —
          you can see both choices and what you did not pick. */}
      <div>
        <div
          role="radiogroup"
          aria-label={t("permissions_role_label")}
          className="flex gap-1 rounded-lg bg-muted/50 p-1"
        >
          {(["member", "junior"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              // NOT disabled while saving. The update is optimistic, so the
              // only thing `pending` bought was freezing the control for the
              // length of a round-trip that included a page revalidation —
              // which is exactly why this felt slow enough to need a refresh.
              // Every save posts the whole desired state, so a fast second
              // click simply wins.
              disabled={disabled}
              onClick={() => role !== r && save(r, extra)}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                role === r
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r === "member" ? t("role_member") : t("role_junior")}
            </button>
          ))}
        </div>
        {/* What the chosen role means, in words. A role name alone tells an
            owner nothing about what they just did to somebody. */}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {role === "member"
            ? t("permissions_member_help")
            : t("permissions_junior_help")}
        </p>
      </div>

      {/* Extras — additions only, never revocations. See the note above. */}
      <div className="space-y-2 border-t border-border/50 pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          {t("permissions_extras_label")}
        </p>
        {GRANTABLE.map((cap) => {
          const on = extra.includes(cap);
          return (
            <label
              key={cap}
              className="flex items-start justify-between gap-3 text-xs"
            >
              <span className="leading-snug text-foreground">
                {cap === "billing.manage"
                  ? t("permissions_cap_billing")
                  : t("permissions_cap_integrations")}
              </span>
              <Switch
                checked={on}
                disabled={disabled}
                onCheckedChange={(next) =>
                  save(
                    role,
                    next
                      ? [...extra, cap]
                      : extra.filter((c) => c !== cap),
                  )
                }
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
