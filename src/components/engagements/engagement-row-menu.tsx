"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  MessageSquare,
  Milestone,
  UserRound,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  archiveEngagementAction,
  unarchiveEngagementAction,
  softDeleteEngagementAction,
  restoreEngagementAction,
  deleteEngagementForeverAction,
} from "@/app/actions/engagements";
import {
  rowMenuItemKeys,
  type EngagementLifecycleState,
} from "@/lib/engagements/lifecycle";
import {
  ENGAGEMENT_STAGES,
  STAGE_BG_CLASS,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";
import { useStageOverride } from "./use-stage-override";
import { reassignEngagementAction } from "@/app/actions/engagements";
import { toastAssigned } from "./assigned-toast";

// Re-exported from the pure lifecycle module so the worklist row imports the
// state type from one place; the menu's option logic lives there too.
export type { EngagementLifecycleState };

export type RowMenuSubItem = {
  key: string;
  label: string;
  // Tailwind background class for the leading colour dot (stage hues).
  dotClass?: string;
  checked?: boolean;
  onSelect: () => void;
};

export type RowMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  // Absent on a submenu item — the parent only opens the child list.
  onSelect?: () => void;
  variant?: "default" | "destructive";
  // When present the item is a SUBMENU (the Stage picker). Both renderers —
  // the "..." dropdown and the right-click context menu — branch on this, so
  // the two surfaces stay identical without either knowing what a stage is.
  submenu?: RowMenuSubItem[];
};

function idForm(id: string): FormData {
  const f = new FormData();
  f.set("id", id);
  return f;
}

// Shared brain for an engagement row's actions. Returns the state-appropriate
// menu items plus the delete-confirmation dialog. Both the right-click context
// menu and the "..." dropdown render the same `items`; the row renders `dialog`
// once. Undo handlers call the server action directly (no component state) so
// they still work after the row has been revalidated out of the list.
//
// Archive / Unarchive / Restore are immediate (with an undo toast). Delete
// opens a confirmation first (it leaves the active board), then soft-deletes
// with its own undo toast. Delete + Restore are gated by `canDelete` (owner).
export function useEngagementRowMenu(args: {
  engagementId: string;
  title: string;
  state: EngagementLifecycleState;
  canDelete: boolean;
  // The engagement's current workflow stage, when it has one. Drives the Stage
  // submenu; absent (a draft / cancelled engagement, or before migration 0690)
  // means no stage item is offered — there's no workflow position to change.
  stage?: EngagementStage | null;
  // When provided (the worklist table), a lifecycle action removes the row
  // from the list instantly and runs the server action itself; the menu just
  // shows the undo toast right away. Without it (e.g. the Needs-attention
  // rows), the menu fires the action and toasts on completion as before.
  runOptimistic?: (id: string, action: () => Promise<unknown>) => void;
  // Team mode: offer "Add a comment" — opens the engagement page with its
  // engagement-level comment composer already open (?comment=1 deep link).
  commentable?: boolean;
  // Active teammates, for the Assign submenu. Before this the row menu could
  // archive, delete, restore and restage an engagement but not hand it to
  // anybody — the one thing you most often want from a list of work. Absent or
  // empty means no Assign item (a solo firm has nobody to assign to).
  assignees?: { id: string; name: string }[];
  // Who holds it now, so the current person can be ticked and skipped.
  assigneeId?: string | null;
  // The signed-in user, so "Take it" can lead the submenu. Same one-click
  // self-assign as the engagement page; Karbon has it in both places too.
  viewerId?: string | null;
}): { items: RowMenuItem[]; dialog: ReactNode } {
  const { engagementId, title, state, canDelete, stage, runOptimistic } = args;
  const t = useTranslations("Engagements");
  const tStage = useTranslations("Stage");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // "Delete forever" dialog state. Non-null = open: "checking" while the
  // server counts the engagement's live files, a number when it found that
  // many (they are KEPT — moved to the client's files — but the engagement
  // itself has no undo, so the dialog asks), "deleting" while the confirmed
  // purge runs. The dialog opens SYNCHRONOUSLY from onSelect — the
  // same beat as the soft-delete confirm above, which is the one
  // menu-into-dialog sequence this codebase knows survives Radix's focus
  // return (see document-actions-menu's onCloseAutoFocus note). Opening it
  // only after the server round-trip looked cleaner but the late open lands
  // mid menu-close and the dialog can dismiss itself instantly.
  const [forever, setForever] = useState<null | "checking" | "deleting" | number>(
    null,
  );
  const { setStage } = useStageOverride(engagementId);

  // Optimistic path: drop the row now + toast now, the server catches up.
  // Fallback path: fire the action, then toast on completion.
  const fire = (action: () => Promise<unknown>, done: () => void) => {
    if (runOptimistic) {
      runOptimistic(engagementId, action);
      done();
    } else {
      void action().then(done);
    }
  };

  // Assign is NOT a lifecycle action: the row stays on the board, only the name
  // on it changes. Using fire() here would optimistically remove the row and it
  // would pop back on the next revalidate.
  const mutate = (action: () => Promise<unknown>, done: () => void) => {
    void action().then(() => {
      done();
      router.refresh();
    });
  };

  const open: RowMenuItem = {
    key: "open",
    label: t("menu_open"),
    icon: ExternalLink,
    onSelect: () => router.push(`/engagements/${engagementId}`),
  };

  const archive: RowMenuItem = {
    key: "archive",
    label: t("menu_archive"),
    icon: Archive,
    onSelect: () =>
      fire(
        () => archiveEngagementAction(idForm(engagementId)),
        () =>
          toast(t("toast_archived"), {
            description: title,
            action: {
              label: t("toast_undo"),
              onClick: () =>
                void unarchiveEngagementAction(idForm(engagementId)),
            },
          }),
      ),
  };

  const unarchive: RowMenuItem = {
    key: "unarchive",
    label: t("menu_unarchive"),
    icon: ArchiveRestore,
    onSelect: () =>
      fire(
        () => unarchiveEngagementAction(idForm(engagementId)),
        () => toast(t("toast_unarchived"), { description: title }),
      ),
  };

  const restore: RowMenuItem = {
    key: "restore",
    label: t("menu_restore"),
    icon: RotateCcw,
    onSelect: () =>
      fire(
        () => restoreEngagementAction(idForm(engagementId)),
        () => toast(t("toast_restored"), { description: title }),
      ),
  };

  const del: RowMenuItem = {
    key: "delete",
    label: t("delete"),
    icon: Trash2,
    variant: "destructive",
    onSelect: () => setConfirmOpen(true),
  };

  // "Delete forever" — only offered on a row that is ALREADY in the bin, and
  // it asks first only when the engagement holds files. The server decides:
  // no files means the first call purges outright and the dialog just closes;
  // otherwise the call comes back with the count, the dialog explains that the
  // files are kept (moved to the client's files) while the engagement itself
  // is gone for good, and only an explicit confirm retries with force.
  const finishForever = (
    res: Awaited<ReturnType<typeof deleteEngagementForeverAction>>,
  ) => {
    if (!res.ok) {
      setForever(null);
      toast.error(t("forever_failed"));
      return;
    }
    if (res.purged) {
      setForever(null);
      toast(t("toast_deleted_forever"), { description: title });
      router.refresh();
    } else {
      // Only morph into the warning if the dialog is still up — the person may
      // have dismissed it while the check was in flight, and a dialog that
      // reopens itself after being closed is exactly the kind of ghost this
      // state machine exists to prevent.
      setForever((prev) => (prev === "checking" ? res.fileCount : prev));
    }
  };

  const deleteForever: RowMenuItem = {
    key: "delete_forever",
    label: t("menu_delete_forever"),
    icon: Trash2,
    variant: "destructive",
    onSelect: () => {
      setForever("checking");
      void deleteEngagementForeverAction({ id: engagementId }).then(
        finishForever,
        () => {
          setForever(null);
          toast.error(t("forever_failed"));
        },
      );
    },
  };

  const confirmForever = () => {
    setForever("deleting");
    void deleteEngagementForeverAction({ id: engagementId, force: true }).then(
      finishForever,
      () => {
        setForever(null);
        toast.error(t("forever_failed"));
      },
    );
  };

  // The Stage picker. Every stage is offered, not just the ones this engagement
  // structurally has: it's an OVERRIDE, so parking an engagement somewhere its
  // contents don't justify is the point — and the next automatic event
  // re-resolves it from reality anyway. (The header stepper, which has the full
  // facts, does hide inapplicable stages; that's a progress display, not a
  // control.)
  const stageItem: RowMenuItem | null = stage
    ? {
        key: "stage",
        label: tStage("change"),
        icon: Milestone,
        submenu: ENGAGEMENT_STAGES.map((s) => ({
          key: s,
          label: tStage(stageLabelKey(s)),
          dotClass: STAGE_BG_CLASS[s],
          checked: s === stage,
          onSelect: () => {
            if (s !== stage) setStage(s);
          },
        })),
      }
    : null;

  // Assign. Same submenu shape as Stage, so both renderers (the "..." dropdown
  // and the right-click menu) already know how to draw it. Deliberately no note
  // No dialog anywhere any more: assigning lands immediately and the note is an
  // optional beat inside the confirmation toast, identically here and on the
  // engagement page. "Take it" and "Nobody" get a plain toast — neither has
  // anyone to write instructions to.
  const assignees = args.assignees ?? [];
  const assignItem: RowMenuItem | null = assignees.length
    ? {
        key: "assign",
        label: t("assign_to"),
        icon: UserRound,
        submenu: [
          // "Take it" first, and only when it would change something. Claiming
          // work you are already looking at should not mean finding your own
          // name in a list of colleagues.
          ...(args.viewerId &&
          args.viewerId !== args.assigneeId &&
          assignees.some((m) => m.id === args.viewerId)
            ? [
                {
                  key: "__me",
                  label: t("assign_to_me"),
                  onSelect: () =>
                    mutate(
                      () =>
                        reassignEngagementAction(engagementId, args.viewerId!),
                      () => toast(t("assigned_toast_me"))),
                },
              ]
            : []),
          ...assignees.map((m) => ({
            key: m.id,
            label: m.name,
            checked: m.id === args.assigneeId,
            onSelect: () => {
              if (m.id === args.assigneeId) return;
              mutate(
                () => reassignEngagementAction(engagementId, m.id),
                // The SAME toast the engagement page shows, so the note is
                // offered in both places instead of only one. This path used to
                // fire a plain toast and silently drop the note entirely — the
                // asymmetry the founder flagged.
                () =>
                  toastAssigned({
                    engagementId,
                    message: t("assigned_toast", { name: m.name }),
                    addNoteLabel: t("assign_add_note"),
                    placeholder: t("assign_note_placeholder"),
                    saveLabel: t("assign_note_send"),
                    savedLabel: t("assign_note_saved"),
                  }),
              );
            },
          })),
          // Unassigning is a real state, not a missing value: work with nobody's
          // name on it is what the dashboard's unassigned bucket is for.
          ...(args.assigneeId
            ? [
                {
                  key: "__none",
                  label: t("assign_nobody"),
                  onSelect: () =>
                    mutate(
                      () => reassignEngagementAction(engagementId, null),
                      () => toast(t("unassigned_toast")),
                    ),
                },
              ]
            : []),
        ],
      }
    : null;

  const byKey: Record<string, RowMenuItem> = {
    open,
    archive,
    unarchive,
    restore,
    delete: del,
    delete_forever: deleteForever,
  };
  const items: RowMenuItem[] = rowMenuItemKeys(state, canDelete).map(
    (k) => byKey[k],
  );
  // Spliced in after Open rather than added to rowMenuItemKeys: that module is
  // about LIFECYCLE (archive / delete / restore), and a stage is a different
  // axis entirely. Keeping it out of there leaves the tested lifecycle rules
  // untouched by a concern they don't own.
  if (stageItem) items.splice(1, 0, stageItem);
  // Assign goes ABOVE Stage: handing work to a person is the commoner action,
  // and splice(1) keeps pushing the earlier insert down.
  if (assignItem) items.splice(1, 0, assignItem);
  // Same reasoning for commenting — spliced in after Open (and before Stage
  // when both are present, since splice(1) pushes Stage down).
  if (args.commentable) {
    items.splice(1, 0, {
      key: "comment",
      label: t("add_comment"),
      icon: MessageSquare,
      onSelect: () => router.push(`/engagements/${engagementId}?comment=1`),
    });
  }

  const confirmDelete = () => {
    setConfirmOpen(false);
    fire(
      () => softDeleteEngagementAction(idForm(engagementId)),
      () =>
        toast(t("toast_deleted"), {
          description: title,
          action: {
            label: t("toast_undo"),
            onClick: () => void restoreEngagementAction(idForm(engagementId)),
          },
        }),
    );
  };

  const dialog = (
    <>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete_title")}</DialogTitle>
            <DialogDescription>{t("delete_desc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("delete_cancel")}
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={confirmDelete}>
              <Trash2 className="size-4" />
              {t("delete_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete forever. Opens in a "checking" beat, then either closes itself
          (no files — purged, no question asked) or explains that the files are
          kept and moved to the client's files while the engagement itself has
          no undo. */}
      <Dialog open={forever != null} onOpenChange={(o) => !o && setForever(null)}>
        <DialogContent
          // The dialog opens from a menu item, and the menu's close beat —
          // focus returning to the trigger, the dismissable-layer teardown —
          // lands OUTSIDE the just-mounted dialog and silently dismisses it
          // (observed live: mounted, gone 250ms later). The repo has hit this
          // Radix race before (see document-actions-menu). Refusing
          // outside-dismissal both dodges the race and is right for a
          // destructive confirm: it closes on Cancel, Escape, or a decision —
          // not on a stray click.
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("forever_title")}</DialogTitle>
            <DialogDescription>
              {typeof forever === "number"
                ? t("forever_desc", { count: forever })
                : t("forever_checking")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={forever === "deleting"}
              >
                {t("delete_cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={typeof forever !== "number"}
              onClick={confirmForever}
            >
              <Trash2 className="size-4" />
              {t("forever_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { items, dialog };
}
