"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
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

// Re-exported from the pure lifecycle module so the worklist row imports the
// state type from one place; the menu's option logic lives there too.
export type { EngagementLifecycleState };

export type RowMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  variant?: "default" | "destructive";
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
}): { items: RowMenuItem[]; dialog: ReactNode } {
  const { engagementId, title, state, canDelete } = args;
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    onSelect: () => {
      void archiveEngagementAction(idForm(engagementId)).then(() => {
        toast(t("toast_archived"), {
          description: title,
          action: {
            label: t("toast_undo"),
            onClick: () => void unarchiveEngagementAction(idForm(engagementId)),
          },
        });
      });
    },
  };

  const unarchive: RowMenuItem = {
    key: "unarchive",
    label: t("menu_unarchive"),
    icon: ArchiveRestore,
    onSelect: () => {
      void unarchiveEngagementAction(idForm(engagementId)).then(() => {
        toast(t("toast_unarchived"), { description: title });
      });
    },
  };

  const restore: RowMenuItem = {
    key: "restore",
    label: t("menu_restore"),
    icon: RotateCcw,
    onSelect: () => {
      void restoreEngagementAction(idForm(engagementId)).then(() => {
        toast(t("toast_restored"), { description: title });
      });
    },
  };

  const del: RowMenuItem = {
    key: "delete",
    label: t("delete"),
    icon: Trash2,
    variant: "destructive",
    onSelect: () => setConfirmOpen(true),
  };

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

  const confirmDelete = () => {
    setConfirmOpen(false);
    void softDeleteEngagementAction(idForm(engagementId)).then(() => {
      toast(t("toast_deleted"), {
        description: title,
        action: {
          label: t("toast_undo"),
          onClick: () => void restoreEngagementAction(idForm(engagementId)),
        },
      });
    });
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
