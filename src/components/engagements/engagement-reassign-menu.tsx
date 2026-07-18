"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ArrowLeftRight } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { reassignEngagementAction } from "@/app/actions/engagements";

// Compact per-row "reassign this engagement" control for the teammate profile's
// work list — hand a colleague's engagement to someone else without leaving the
// page. Quick move (no note dialog here; the assignee is still notified, and the
// engagement page offers the full reassign-with-note flow). Reuses
// reassignEngagementAction, which handles the notification + catch-up email.
export function EngagementReassignMenu({
  engagementId,
  members,
}: {
  engagementId: string;
  // Reassignment targets — active teammates other than the current owner.
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (members.length === 0) return null;

  function reassign(memberId: string) {
    startTransition(async () => {
      const res = await reassignEngagementAction(engagementId, memberId);
      if (res.ok) router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={t("profile_reassign")}
          title={t("profile_reassign")}
          className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        >
          <ArrowLeftRight className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t("profile_reassign_to")}</DropdownMenuLabel>
        {members.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => reassign(m.id)}
            className="gap-2"
          >
            <AvatarInitials name={m.name} size={20} />
            <span className="flex-1 truncate">{m.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
