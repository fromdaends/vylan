"use client";

// Everyone in the firm, at a glance.
//
// "Members" in the firm menu used to be a link to the page you were already
// standing on, which is a button that does nothing. Discord's equivalent is a
// PANEL: the member list grouped by role, each name tinted by the role it is
// under, with a count per group. That is what this is.
//
// A person appears ONCE, under their first role — the same rule Discord uses
// for its sidebar. Listing somebody under every role they hold turns a roster
// into a matrix and makes the counts lie.

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { roleTextClass, roleSwatchClass } from "@/lib/roles/palette";

export type DialogMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  isSelf: boolean;
  avatarUrl?: string | null;
  roles?: { id: string; name: string; color: string }[];
};

export function MembersDialog({
  open,
  onOpenChange,
  members,
  canOpenProfiles,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  members: DialogMember[];
  /** Profiles are owner-only; without it the rows are not links. */
  canOpenProfiles: boolean;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = members.filter(
      (m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    );

    // Bucket by first role; everyone roleless falls to the end. The map keeps
    // insertion order, and members arrive owner-first then alphabetical, so
    // the groups come out in a stable order without a second sort.
    const byRole = new Map<
      string,
      { name: string; color: string; people: DialogMember[] }
    >();
    const noRole: DialogMember[] = [];
    for (const m of shown) {
      const first = m.roles?.[0];
      if (!first) {
        noRole.push(m);
        continue;
      }
      const bucket = byRole.get(first.id);
      if (bucket) bucket.people.push(m);
      else
        byRole.set(first.id, {
          name: first.name,
          color: first.color,
          people: [m],
        });
    }

    const out = [...byRole.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (noRole.length > 0) {
      out.push({ name: t("members_no_role"), color: "slate", people: noRole });
    }
    return out;
  }, [members, query, t]);

  const total = members.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("members_dialog_title", { count: total })}</DialogTitle>
          <DialogDescription>{t("members_dialog_hint")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("roles_search_members")}
            aria-label={t("roles_search_members")}
            className="pl-8"
          />
        </div>

        <div className="-mx-1 max-h-[22rem] overflow-y-auto px-1">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("members_none_match")}
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.name} className="mb-4 last:mb-0">
                <p className="mb-1 flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${roleSwatchClass(g.color)}`}
                    aria-hidden
                  />
                  {g.name} — {g.people.length}
                </p>
                <ul>
                  {g.people.map((m) => {
                    const tinted = m.roles?.[0]?.color;
                    const row = (
                      <>
                        <AvatarInitials
                          name={m.name}
                          src={m.avatarUrl ?? undefined}
                          size={32}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-sm font-medium ${
                                tinted ? roleTextClass(tinted) : ""
                              }`}
                            >
                              {m.name}
                            </span>
                            {m.isSelf && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {t("you")}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.email}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={m.id}>
                        {canOpenProfiles ? (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenChange(false);
                              router.push(`/settings/team/${m.id}`);
                            }}
                            className="flex w-full items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row}
                          </button>
                        ) : (
                          <div className="flex items-center gap-3 px-1.5 py-1.5">
                            {row}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
