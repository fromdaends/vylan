"use client";

// Who works on this client — the cast, in the client page's rail.
//
// ⚠️ IT DOES NOT CONTROL ACCESS YET, and the panel says so out loud rather than
// leaving a firm to assume it does. Phase 3 slice 1 exists so the list is
// filled in and correct BEFORE the row-level rules start reading it; a firm
// that thought it was already restricting access would be storing up exactly
// the wrong kind of surprise.
//
// Quiet by construction: names with a position beside them, a "+" that opens a
// picker of the teammates not already on, and an ✕ on hover. No section header
// full of buttons — the founder's standing objection.

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addClientMemberAction,
  removeClientMemberAction,
} from "@/app/actions/client-members";

type Member = { userId: string; name: string; position: string | null };
type Candidate = { id: string; name: string };

export function ClientTeam({
  clientId,
  members,
  candidates,
  canEdit,
}: {
  clientId: string;
  members: Member[];
  /** Active teammates not already on this client. */
  candidates: Candidate[];
  canEdit: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  async function add(userId: string) {
    setBusy(userId);
    try {
      const res = await addClientMemberAction({ clientId, userId });
      if (!res.ok) {
        toast.error(
          res.needsMigration ? t("team_needs_migration") : t("team_failed"),
        );
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(userId);
    try {
      const res = await removeClientMemberAction({ clientId, userId });
      if (!res.ok) {
        toast.error(
          res.needsMigration ? t("team_needs_migration") : t("team_failed"),
        );
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("team_empty")}</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.userId} className="group flex items-center gap-2.5">
              <AvatarInitials name={m.name} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{m.name}</span>
                {m.position && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.position}
                  </span>
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(m.userId)}
                  disabled={busy === m.userId}
                  aria-label={t("team_remove", { name: m.name })}
                  title={t("team_remove", { name: m.name })}
                  className="shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && candidates.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("team_add")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {candidates.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => add(c.id)}
                className="gap-2"
              >
                <AvatarInitials name={c.name} size={20} />
                <span className="flex-1 truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Said plainly, once. A firm that assumed this list already restricted
          access would be storing up the worst kind of surprise. */}
      <p className="border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
        {t("team_not_access_yet")}
      </p>
    </div>
  );
}
