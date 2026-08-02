"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Download,
  Eye,
  EyeOff,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteDocumentAction,
  logDocumentDownloadAction,
  moveDocumentAction,
  renameDocumentAction,
  setDocumentVisibilityAction,
} from "@/app/actions/documents";
import { BROWSE_CATEGORIES, categoryForDocType } from "@/lib/files/axes";
import { DOC_TYPE_LABELS, docTypeGroupLabel } from "@/lib/doc-types";
import type { DocType } from "@/lib/db/templates";

// The per-file actions menu.
//
// Rename and Move both open a dialog from a menu item. That needs the
// onCloseAutoFocus dance below rather than a plain onSelect — a Radix menu
// closing while a dialog opens will otherwise steal focus back and the dialog
// dismisses itself instantly. This bit the product once already.

type Source = "checklist" | "final" | "imported";

export function DocumentActionsMenu({
  source,
  id,
  name,
  year,
  category,
  docType,
  canMove,
  visibility,
  locale,
}: {
  source: Source;
  id: string;
  name: string;
  year: number | null;
  category: string | null;
  docType: DocType | null;
  /** False while the AI is still reading it — its answer would land on top. */
  canMove: boolean;
  /** 'firm' = hidden from the client everywhere. */
  visibility: "client" | "firm";
  locale: "en" | "fr";
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | "rename" | "move" | "delete">(null);

  const [newName, setNewName] = useState(name);
  const [moveType, setMoveType] = useState<string>(docType ?? "none");
  const [moveYear, setMoveYear] = useState<string>(
    year != null ? String(year) : "unsorted",
  );
  const [moveCategory, setMoveCategory] = useState<string>(category ?? "unsorted");

  const bytesUrl = `/api/files/${id}?source=${source}`;

  function download() {
    // Point the browser at the bytes first so the download starts immediately,
    // THEN record it. The log is best-effort by design (see the server action)
    // — a slow audit write must never sit between a click and a file.
    window.location.href = `${bytesUrl}&download=1`;
    void logDocumentDownloadAction({ source, id });
  }

  function toggleVisibility() {
    // No dialog, no focus dance — a plain fire-and-refresh menu action.
    const next = visibility === "firm" ? "client" : "firm";
    startTransition(async () => {
      const res = await setDocumentVisibilityAction({ source, id, visibility: next });
      if (res.ok) {
        router.refresh();
        toast.success(
          next === "firm" ? t("visibility_done_firm") : t("visibility_done_client"),
        );
        // "Client-visible" on an import is permission, not delivery: no
        // portal surface lists imports until share-from-Files exists, and
        // pretending otherwise is a false impression.
        if (next === "client" && source === "imported") {
          toast.info(t("visibility_import_note"));
        }
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  function submitRename() {
    startTransition(async () => {
      const res = await renameDocumentAction({ source, id, name: newName });
      if (res.ok) {
        setDialog(null);
        router.refresh();
        toast.success(t("rename_done"));
      } else {
        toast.error(res.error === "invalid" ? t("rename_invalid") : t("action_failed"));
      }
    });
  }

  function submitDelete() {
    startTransition(async () => {
      const res = await deleteDocumentAction({ source, id });
      if (res.ok) {
        setDialog(null);
        router.refresh();
        toast.success(t("delete_done"));
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  function submitMove() {
    startTransition(async () => {
      const res = await moveDocumentAction({
        source,
        id,
        docType: moveType,
        year: moveYear,
        category: moveCategory,
      });
      if (res.ok) {
        setDialog(null);
        router.refresh();
        toast.success(t("move_done"));
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  // Picking a document type fills in the folder it implies, because that is the
  // pairing the filing convention already encodes (a T4 is a federal slip). It
  // is only a SUGGESTION — the category select stays editable underneath, so a
  // firm that files differently is never fought with.
  function onTypeChange(next: string) {
    setMoveType(next);
    if (next !== "none" && next in DOC_TYPE_LABELS) {
      const implied = categoryForDocType(next as DocType);
      if (implied) setMoveCategory(implied);
    }
  }

  const years = (() => {
    const now = new Date().getFullYear();
    const list = Array.from({ length: 12 }, (_, i) => now - i);
    // Never drop the document's own year off the list just because it is old.
    if (year != null && !list.includes(year)) list.push(year);
    return list.sort((a, b) => b - a);
  })();

  const typeOptions = Object.entries(DOC_TYPE_LABELS)
    .map(([code, meta]) => ({ code, label: meta[locale].split(" — ")[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("row_actions", { name })}
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48"
          // Opening a dialog from a menu item: the dialog must open AFTER the
          // menu has finished closing, or Radix hands focus back to the trigger
          // and the dialog closes on the same tick.
          onCloseAutoFocus={(e) => {
            if (dialog) e.preventDefault();
          }}
        >
          <DropdownMenuItem asChild>
            <a href={bytesUrl} target="_blank" rel="noopener noreferrer" className="gap-2">
              <Eye className="size-4" />
              {t("action_preview")}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault();
              download();
            }}
          >
            <Download className="size-4" />
            {t("action_download")}
          </DropdownMenuItem>
          {source !== "checklist" && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => toggleVisibility()}
          >
            {visibility === "firm" ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            {visibility === "firm"
              ? t("action_make_client_visible")
              : t("action_make_firm_only")}
          </DropdownMenuItem>
          )}
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
            className="gap-2"
            disabled={!canMove}
            onSelect={(e) => {
              e.preventDefault();
              if (!canMove) return;
              setDialog("move");
            }}
          >
            <FolderInput className="size-4" />
            {t("action_move")}
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

      {/* Rename */}
      <Dialog open={dialog === "rename"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rename_title")}</DialogTitle>
            <DialogDescription>{t("rename_help")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="doc-rename">{t("rename_label")}</Label>
            <Input
              id="doc-rename"
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

      {/* Delete — a soft delete, so the copy says "recoverable", not "gone".
          Overstating it would make people hesitate over an undoable action. */}
      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("delete_title")}</DialogTitle>
            <DialogDescription>{t("delete_help", { name })}</DialogDescription>
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

      {/* Move */}
      <Dialog open={dialog === "move"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("move_title")}</DialogTitle>
            <DialogDescription>{t("move_help")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("move_type")}</Label>
              <Select value={moveType} onValueChange={onTypeChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("move_type_none")}</SelectItem>
                  {typeOptions.map((o) => (
                    <SelectItem key={o.code} value={o.code}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("move_year")}</Label>
                <Select value={moveYear} onValueChange={setMoveYear}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                    <SelectItem value="unsorted">{t("unsorted")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("move_category")}</Label>
                <Select value={moveCategory} onValueChange={setMoveCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROWSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {docTypeGroupLabel(c, locale)}
                      </SelectItem>
                    ))}
                    <SelectItem value="unsorted">{t("unsorted")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("move_note")}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={submitMove} disabled={pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
