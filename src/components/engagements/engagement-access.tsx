"use client";

// "Let somebody see just this job."
//
// The last item of phase 3. Membership so far has been a property of the
// CLIENT — you are on the client, so you see everything under it. That is the
// right default and the wrong only option: "have a look at this one return"
// should not mean "here is everything we do for this company, including last
// year's, the invoices and the bank feed".
//
// OWNER-ONLY, and the control is quiet — a line of faces and a small "+", not a
// panel. It is a rare, deliberate act, and the founder's standing rule is that
// a control lives on the object it acts on rather than taking a section of its
// own.
//
// WHAT IT DOES NOT SHOW: people who can already see this engagement through the
// client. Listing them would make the control look like the engagement's whole
// audience, which it is not — it is the list of EXCEPTIONS. Anybody on the
// client is covered by the client, and taking them off here would do nothing.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addEngagementMemberAction,
  removeEngagementMemberAction,
  type EngagementMemberResult,
} from "@/app/actions/engagement-members";

type Person = { id: string; name: string };

export function EngagementAccess({
  engagementId,
  guests,
  candidates,
}: {
  engagementId: string;
  /** Already let in through THIS engagement — the exceptions. */
  guests: Person[];
  /** Everyone who cannot already see it another way. */
  candidates: Person[];
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function report(res: EngagementMemberResult) {
    if (res.ok) {
      startTransition(() => router.refresh());
      return;
    }
    toast.error(
      res.needsMigration ? t("access_needs_migration") : t("access_failed"),
    );
  }

  async function add(userId: string) {
    setBusy(userId);
    try {
      report(await addEngagementMemberAction({ engagementId, userId }));
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(userId);
    try {
      report(await removeEngagementMemberAction({ engagementId, userId }));
    } finally {
      setBusy(null);
    }
  }

  // Nothing to say and nobody to add: draw nothing at all rather than an empty
  // control. A solo firm should never meet this.
  if (guests.length === 0 && candidates.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {guests.map((g) => (
        <span
          key={g.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-1.5 text-xs"
        >
          <AvatarInitials name={g.name} size={18} />
          <span className="max-w-[10rem] truncate">{g.name}</span>
          <button
            type="button"
            disabled={busy === g.id}
            onClick={() => remove(g.id)}
            aria-label={t("access_remove", { name: g.name })}
            title={t("access_remove", { name: g.name })}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}

      {candidates.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <UserPlus className="size-3.5" aria-hidden />
              {guests.length === 0 ? t("access_add_first") : t("access_add")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1">
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {t("access_hint")}
            </p>
            <ul className="max-h-64 overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => add(c.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <AvatarInitials name={c.name} size={22} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
