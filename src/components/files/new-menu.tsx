"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FolderPlus, FolderUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportWizard } from "./import-wizard";
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
  const [dialog, setDialog] = useState<null | "import" | "folder">(null);
  const pendingDialog = useRef<null | "import" | "folder">(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" aria-hidden />
            {t("new_button")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(e) => {
            if (pendingDialog.current) {
              e.preventDefault();
              setDialog(pendingDialog.current);
              pendingDialog.current = null;
            }
          }}
        >
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              pendingDialog.current = "import";
            }}
          >
            <FolderUp className="size-4" aria-hidden />
            {t("import_button")}
          </DropdownMenuItem>
          {clientId && (
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => {
                pendingDialog.current = "folder";
              }}
            >
              <FolderPlus className="size-4" aria-hidden />
              {t("folder_new")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
