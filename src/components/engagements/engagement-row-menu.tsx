"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Milestone,
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
}): { items: RowMenuItem[]; dialog: ReactNode } {
  const { engagementId, title, state, canDelete, stage, runOptimistic } = args;
  const t = useTranslations("Engagements");
  const tStage = useTranslations("Stage");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  const byKey: Record<string, RowMenuItem> = {
    open,
    archive,
    unarchive,
    restore,
    delete: del,
  };
  const items: RowMenuItem[] = rowMenuItemKeys(state, canDelete).map(
    (k) => byKey[k],
  );
  // Spliced in after Open rather than added to rowMenuItemKeys: that module is
  // about LIFECYCLE (archive / delete / restore), and a stage is a different
  // axis entirely. Keeping it out of there leaves the tested lifecycle rules
  // untouched by a concern they don't own.
  if (stageItem) items.splice(1, 0, stageItem);

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
  );

  return { items, dialog };
}
