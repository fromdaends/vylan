"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AlertTriangle, Check, ChevronDown, UserRound } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { reassignClientAction } from "@/app/actions/clients";

// "Owner / Propriétaire" control on the client detail page. Shows who owns the
// client (avatar + name) and lets any firm member reassign to any ACTIVE member.
// Mirrors EngagementAssignee: accountability only — clients stay firm-visible.
// Only rendered when team mode is active (the caller gates on hasActiveTeam).
export function ClientAssignee({
  clientId,
  assigneeId,
  assigneeName,
  assigneeDeactivated,
  members,
}: {
  clientId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeDeactivated: boolean;
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic label so the new owner shows immediately on click.
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const displayName = optimisticName ?? assigneeName;

  function reassign(memberId: string, memberName: string) {
    if (memberId === assigneeId) return;
    setOptimisticName(memberName);
    startTransition(async () => {
      const res = await reassignClientAction(clientId, memberId);
      if (res.ok) {
        router.refresh();
      } else {
        setOptimisticName(null); // revert on failure
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("col_owner")}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 py-1 pl-1 pr-2.5 text-sm transition-colors hover:bg-card disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {displayName ? (
                <>
                  <AvatarInitials name={displayName} size={20} />
                  <span className="font-medium text-foreground">
                    {displayName}
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-3" />
                  </span>
                  <span className="italic text-muted-foreground">
                    {t("owner_unassigned")}
                  </span>
                </>
              )}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => reassign(m.id, m.name)}
                className="gap-2"
              >
                <AvatarInitials name={m.name} size={20} />
                <span className="flex-1 truncate">{m.name}</span>
                {m.id === assigneeId && (
                  <Check className="size-3.5 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {assigneeDeactivated && !optimisticName && (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
          <AlertTriangle className="size-3" />
          {t("owner_deactivated")}
        </div>
      )}
    </div>
  );
}
