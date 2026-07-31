"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deactivateUser } from "@/app/actions/team";
import { useErrorMessage } from "@/components/settings/team/team-manager";

// Removing a teammate — moved OFF the firm roster's row menu and onto the
// person's own page.
//
// Two reasons, and the second is the one that decided it. (1) Karbon puts every
// colleague action on that colleague's page and has no row controls at all;
// their roster row is purely a link. (2) The roster row is now a button — the
// whole row opens the person — so a "..." trigger sitting inside it was a click
// target inside a click target, which is exactly what people mis-click. The
// menu held ONE item, so the menu itself was mostly ceremony.
//
// The dialog is unchanged: guarded offboarding, showing what the person still
// holds and offering to hand it to a teammate so nothing is orphaned. That
// guard is the whole value of this flow and moving it must not dilute it.
export function DeactivateMember({
  memberId,
  memberName,
  activeEngagements,
  clientCount,
  scheduleCount,
  reassignTargets,
}: {
  memberId: string;
  memberName: string;
  activeEngagements: number;
  clientCount: number;
  // Recurring schedules (0940). Counted because a schedule keeps minting NEW
  // work every cycle — leaving one behind is worse than leaving a finished
  // engagement behind, yet it used to make this dialog say "holds nothing".
  scheduleCount: number;
  // Other active members this person's work can be handed to.
  reassignTargets: { id: string; name: string }[];
}) {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const holdsWork =
    activeEngagements > 0 || clientCount > 0 || scheduleCount > 0;
  const canReassign = holdsWork && reassignTargets.length > 0;
  const [reassignTo, setReassignTo] = useState<string>(
    reassignTargets[0]?.id ?? "",
  );

  // reassignToId null = "remove anyway" (leave their work as-is).
  function doDeactivate(reassignToId: string | null) {
    startTransition(async () => {
      const res = await deactivateUser(memberId, reassignToId);
      if (res.ok) {
        toast.success(t("member_deactivated"));
        // Back to the roster: the page you are standing on describes someone
        // who no longer has access, so staying here would be a dead end.
        router.push("/settings/team");
        router.refresh();
      } else {
        toast.error(errorMessage(res.error));
      }
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start text-muted-foreground hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
      >
        <UserMinus className="size-4" />
        {t("menu_deactivate")}
      </Button>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deactivate_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("deactivate_confirm_body", { name: memberName })}
            </DialogDescription>
          </DialogHeader>

          {/* Guarded offboarding: if this person holds live work, show it and
              offer to hand it to a teammate so nothing is orphaned. */}
          {holdsWork && (
            <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
              <p className="text-sm">
                {scheduleCount > 0
                  ? t("offboard_holds_with_schedules", {
                      name: memberName,
                      engagements: activeEngagements,
                      clients: clientCount,
                      schedules: scheduleCount,
                    })
                  : t("offboard_holds", {
                      name: memberName,
                      engagements: activeEngagements,
                      clients: clientCount,
                    })}
              </p>
              {canReassign && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("offboard_reassign_label")}
                  </span>
                  <select
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                    disabled={pending}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {reassignTargets.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            {canReassign ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => doDeactivate(null)}
                  disabled={pending}
                >
                  {t("offboard_remove_anyway")}
                </Button>
                <Button
                  type="button"
                  onClick={() => doDeactivate(reassignTo)}
                  disabled={pending || !reassignTo}
                >
                  {t("offboard_reassign_remove")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={() => doDeactivate(null)}
                disabled={pending}
              >
                {t("menu_deactivate")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
