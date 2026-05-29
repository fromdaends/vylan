"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteEngagementAction } from "@/app/actions/engagements";

// Destructive "Delete engagement" control: a ghost button that opens a
// confirmation dialog. Confirming submits the server action (which deletes,
// revalidates, and redirects to the dashboard). Used for non-draft
// engagements — drafts keep their own instant "Delete draft" button.
export function DeleteEngagementButton({
  engagementId,
  locale,
}: {
  engagementId: string;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Engagements");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
          {t("delete")}
        </Button>
      </DialogTrigger>
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
          <form action={deleteEngagementAction}>
            <input type="hidden" name="id" value={engagementId} />
            <input type="hidden" name="__app_locale" value={locale} />
            <Button type="submit" variant="destructive">
              <Trash2 className="size-4" />
              {t("delete_confirm")}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
