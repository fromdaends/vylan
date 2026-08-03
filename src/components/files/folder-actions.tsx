"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createFolderAction,
  deleteFolderAction,
  renameFolderAction,
} from "@/app/actions/folders";

function errorMessage(
  t: (k: string) => string,
  error: string | undefined,
): string {
  if (error === "name_taken") return t("folder_name_taken");
  if (error === "cycle") return t("folder_cycle");
  return t("action_failed");
}

/** "New folder", for the client view and inside any folder. */
export function NewFolderButton({
  clientId,
  parentId,
  externalOpen,
  onExternalOpenChange,
}: {
  clientId: string;
  parentId: string | null;
  /** The "+ New" menu drives this dialog from outside; when provided, the
   * component renders no button of its own. */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createFolderAction({ clientId, parentId, name });
      if (res.ok) {
        setOpen(false);
        setName("");
        router.refresh();
        toast.success(t("folder_created"));
      } else {
        toast.error(errorMessage(t, res.error));
      }
    });
  }

  return (
    <>
      {externalOpen === undefined && (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          setName("");
          setOpen(true);
        }}
      >
        <FolderPlus className="size-4" aria-hidden />
        {t("folder_new")}
      </Button>
      )}
      <Dialog
        open={externalOpen ?? open}
        onOpenChange={(o) => {
          if (externalOpen === undefined) setOpen(o);
          else onExternalOpenChange?.(o);
          if (o) setName("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("folder_new_title")}</DialogTitle>
            <DialogDescription>{t("folder_new_help")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">{t("folder_name")}</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) submit();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !name.trim()}>
              {t("folder_create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Rename / delete, on each custom folder row. */
export function FolderRowMenu({
  clientId,
  folderId,
  name,
}: {
  clientId: string;
  folderId: string;
  name: string;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "rename" | "delete">(null);
  const [newName, setNewName] = useState(name);
  const [pending, startTransition] = useTransition();

  function submitRename() {
    startTransition(async () => {
      const res = await renameFolderAction({ clientId, folderId, name: newName });
      if (res.ok) {
        setDialog(null);
        router.refresh();
        toast.success(t("folder_renamed"));
      } else {
        toast.error(errorMessage(t, res.error));
      }
    });
  }

  function submitDelete() {
    startTransition(async () => {
      const res = await deleteFolderAction({ clientId, folderId });
      if (res.ok) {
        setDialog(null);
        router.refresh();
        toast.success(t("folder_deleted"));
      } else {
        toast.error(errorMessage(t, res.error));
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("folder_actions", { name })}
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          onCloseAutoFocus={(e) => {
            if (dialog) e.preventDefault();
          }}
        >
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault();
              setNewName(name);
              setDialog("rename");
            }}
          >
            <Pencil className="size-4" />
            {t("action_rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-destructive focus:text-destructive"
            onSelect={(e) => {
              e.preventDefault();
              setDialog("delete");
            }}
          >
            <Trash2 className="size-4" />
            {t("action_delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "rename"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("folder_rename_title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-rename">{t("folder_name")}</Label>
            <Input
              id="folder-rename"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) submitRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={submitRename} disabled={pending || !newName.trim()}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("folder_delete_title", { name })}</DialogTitle>
            {/* Says plainly that nothing inside is lost — otherwise people keep
                empty folders forever rather than risk it. */}
            <DialogDescription>{t("folder_delete_help")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={submitDelete} disabled={pending}>
              {t("action_delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
