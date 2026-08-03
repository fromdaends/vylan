"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FolderPlus, FolderUp, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportWizard } from "./import-wizard";
import { QuickUpload } from "./quick-upload";
import { NewFolderButton } from "./folder-actions";

// THE "+ NEW" BUTTON (Files v2 §7) — Drive's one entry point for putting
// things into the system, replacing the standalone Import button. The menu is
// context-aware: importing exists everywhere; "New folder" only inside a
// client, because a folder belongs to one (founder ruling: folders stay
// freely creatable — the spec's guided-picker line predates that).
//
// Menu items OPEN DIALOGS, which on Radix means the onCloseAutoFocus dance:
// opening a dialog straight from onSelect lets the closing menu steal focus
// back and the dialog dismisses itself instantly. This bit the product once
// already (see document-actions-menu) — the menu notes WHICH dialog to open
// and opens it only after the menu has fully closed.

export function NewMenu({
  clients,
  clientId,
  folderParentId,
}: {
  clients: { id: string; name: string }[];
  /** Present when browsing inside a client — enables "New folder". */
  clientId: string | null;
  /** The folder the user is looking at, so a new folder lands where they are. */
  folderParentId: string | null;
}) {
  const t = useTranslations("Files");
  const [dialog, setDialog] = useState<null | "upload" | "import" | "folder">(null);
  const pendingDialog = useRef<null | "upload" | "import" | "folder">(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Drive-sized: the one button that puts things INTO the system is
              the biggest control on the screen, not another toolbar chip. */}
          <Button className="h-11 gap-2 rounded-xl px-5 text-[15px] shadow-md">
            <Plus className="size-5" aria-hidden />
            {t("new_button")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          // origin-top-left makes the open animation GROW out of the button's
          // corner, the way Drive's New menu does, instead of fading in place.
          className="min-w-56 origin-top-left p-1.5 shadow-xl duration-150"
          onCloseAutoFocus={(e) => {
            if (pendingDialog.current) {
              e.preventDefault();
              setDialog(pendingDialog.current);
              pendingDialog.current = null;
            }
          }}
        >
          {/* Quick upload first — "the client just handed me three PDFs" is
              the everyday case; migrating a whole folder tree is not. */}
          <DropdownMenuItem
            className="gap-3 rounded-lg px-3 py-2.5 text-[15px]"
            onSelect={() => {
              pendingDialog.current = "upload";
            }}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            {t("upload_title")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-3 rounded-lg px-3 py-2.5 text-[15px]"
            onSelect={() => {
              pendingDialog.current = "import";
            }}
          >
            <FolderUp className="size-5 text-muted-foreground" aria-hidden />
            {t("import_folder_button")}
          </DropdownMenuItem>
          {clientId && (
            <DropdownMenuItem
              className="gap-3 rounded-lg px-3 py-2.5 text-[15px]"
              onSelect={() => {
                pendingDialog.current = "folder";
              }}
            >
              <FolderPlus className="size-5 text-muted-foreground" aria-hidden />
              {t("folder_new")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickUpload
        clients={clients}
        defaultClientId={clientId}
        externalOpen={dialog === "upload"}
        onExternalOpenChange={(o) => setDialog(o ? "upload" : null)}
      />
      <ImportWizard
        clients={clients}
        externalOpen={dialog === "import"}
        onExternalOpenChange={(o) => setDialog(o ? "import" : null)}
      />
      {clientId && (
        <NewFolderButton
          clientId={clientId}
          parentId={folderParentId}
          externalOpen={dialog === "folder"}
          onExternalOpenChange={(o) => setDialog(o ? "folder" : null)}
        />
      )}
    </>
  );
}
