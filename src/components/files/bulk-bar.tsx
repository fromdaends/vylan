"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, FolderInput, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bulkDeleteDocumentsAction,
  bulkMoveDocumentsAction,
} from "@/app/actions/documents";
import { setDocumentsFolderAction } from "@/app/actions/folders";
import { bulkSetVisibilityAction } from "@/app/actions/documents";
import { BROWSE_CATEGORIES, categoryForDocType } from "@/lib/files/axes";
import { DOC_TYPE_LABELS, docTypeGroupLabel } from "@/lib/doc-types";
import { parseSelectionKey, useFileSelection } from "./file-selection";
import type { DocType } from "@/lib/db/templates";

// The bulk action bar. Appears only once something is selected, pinned to the
// bottom of the viewport so it stays reachable while scrolling a long folder —
// which is the whole situation it exists for.
export function BulkBar({
  locale,
  folders,
}: {
  locale: "en" | "fr";
  /** The current client's custom folders. Absent outside a client, where
   * "file into a folder" has no single destination to offer. */
  folders?: { id: string; name: string }[];
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const selection = useFileSelection();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | "move" | "delete">(null);

  // "keep" is the explicit do-not-touch value. Bulk move must be able to set
  // ONLY the folder without also blanking the year of 200 documents, so an
  // untouched field has to mean "leave it", never "clear it".
  const [moveType, setMoveType] = useState("keep");
  const [moveYear, setMoveYear] = useState("keep");
  const [moveCategory, setMoveCategory] = useState("keep");

  if (!selection || selection.selected.size === 0) return null;
  const keys = [...selection.selected];
  const targets = keys.map(parseSelectionKey);
  const count = targets.length;

  function onTypeChange(next: string) {
    setMoveType(next);
    if (next !== "keep" && next !== "none" && next in DOC_TYPE_LABELS) {
      const implied = categoryForDocType(next as DocType);
      if (implied) setMoveCategory(implied);
    }
  }

  function submitMove() {
    startTransition(async () => {
      const res = await bulkMoveDocumentsAction({
        targets,
        // "keep" is sent as undefined so the server leaves that axis alone.
        docType: moveType === "keep" ? undefined : moveType,
        year: moveYear === "keep" ? undefined : moveYear,
        category: moveCategory === "keep" ? undefined : moveCategory,
      });
      setDialog(null);
      selection?.clear();
      router.refresh();
      // Always report the real numbers. A bulk action that half-worked and said
      // nothing is how a firm ends up with files they think they filed.
      if (res.failed > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.ok) {
        toast.success(t("bulk_moved", { count: res.succeeded }));
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  const folderLabel = (id: string) =>
    folders?.find((f) => f.id === id)?.name ?? "";

  function setVisibility(value: string) {
    if (value !== "client" && value !== "firm") return;
    startTransition(async () => {
      const res = await bulkSetVisibilityAction({ targets, visibility: value });
      selection?.clear();
      router.refresh();
      if (res.failed > 0 && res.succeeded > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.failed > 0) {
        toast.error(t("action_failed"));
      } else {
        toast.success(
          value === "firm"
            ? t("bulk_visibility_firm", { count: res.succeeded })
            : t("bulk_visibility_client", { count: res.succeeded }),
        );
        if (res.skipped > 0) {
          toast.info(t("bulk_visibility_skipped", { count: res.skipped }));
        }
        if (value === "client" && targets.some((x) => x.source === "imported")) {
          toast.info(t("visibility_import_note"));
        }
      }
    });
  }

  function fileIntoFolder(value: string) {
    startTransition(async () => {
      const res = await setDocumentsFolderAction({
        targets,
        // "__none__" takes documents back out of any folder, returning them to
        // the derived year/category view rather than leaving them nowhere.
        folderId: value === "__none__" ? null : value,
      });
      selection?.clear();
      router.refresh();
      // Same honesty rule as the drag path: documents already in the chosen
      // folder are skipped, not counted as moved.
      if (res.failed > 0 && res.succeeded > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.failed > 0) {
        toast.error(t("action_failed"));
      } else if (res.succeeded > 0) {
        toast.success(t("bulk_moved", { count: res.succeeded }));
      } else if (res.skipped > 0) {
        toast.info(
          t("drop_already_there", {
            folder: value === "__none__" ? t("path_root") : folderLabel(value),
          }),
        );
      } else {
        toast.info(t("drop_nothing"));
      }
    });
  }

  function submitDelete() {
    startTransition(async () => {
      const res = await bulkDeleteDocumentsAction({ targets });
      setDialog(null);
      selection?.clear();
      router.refresh();
      if (res.failed > 0) {
        toast.warning(t("bulk_partial", { done: res.succeeded, failed: res.failed }));
      } else if (res.ok) {
        toast.success(t("bulk_deleted", { count: res.succeeded }));
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  function downloadZip() {
    // Two steps, and the indirection is load-bearing: the route builds the ZIP,
    // stores it, and returns a signed URL rather than the bytes. Returning the
    // archive as a response body crashes Vercel's Node runtime with an empty
    // 500 — recorded in production on the engagement export, for both streamed
    // and buffered bodies. So fetch the URL, then send the browser to it.
    startTransition(async () => {
      const qs = new URLSearchParams({ ids: keys.join(",") });
      try {
        const res = await fetch(`/api/files/bulk-zip?${qs.toString()}`);
        const body = (await res.json()) as {
          url?: string;
          count?: number;
          skipped?: number;
        };
        if (!res.ok || !body.url) {
          toast.error(t("action_failed"));
          return;
        }
        if (body.skipped) {
          toast.warning(
            t("bulk_partial", { done: body.count ?? 0, failed: body.skipped }),
          );
        }
        window.location.href = body.url;
      } catch {
        toast.error(t("action_failed"));
      }
    });
  }

  const years = (() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, i) => now - i);
  })();
  const typeOptions = Object.entries(DOC_TYPE_LABELS)
    .map(([code, meta]) => ({ code, label: meta[locale].split(" — ")[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:left-[var(--rail-width)]">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
          <span className="px-1 text-sm font-medium">
            {t("bulk_selected", { count })}
          </span>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={downloadZip}>
            <Download className="size-3.5" aria-hidden />
            {t("action_download")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setDialog("move")}
          >
            <FolderInput className="size-3.5" aria-hidden />
            {t("action_move")}
          </Button>
          {/* Client-visible vs firm-only, in bulk. A Select rather than one
              toggle button because a mixed selection has no single "current"
              state to flip. */}
          {targets.some((x) => x.source !== "checklist") && (
          <Select value="" onValueChange={setVisibility}>
            <SelectTrigger size="sm" className="w-[9.5rem]" aria-label={t("bulk_visibility")}>
              <SelectValue placeholder={t("bulk_visibility")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="firm">{t("visibility_firm")}</SelectItem>
              <SelectItem value="client">{t("visibility_client")}</SelectItem>
            </SelectContent>
          </Select>
          )}
          {/* Filing into a folder the firm made is a different act from setting
              a document's year and category, so it gets its own control rather
              than a fourth dropdown buried in the Move dialog. */}
          {folders && folders.length > 0 && (
            <Select value="" onValueChange={fileIntoFolder}>
              <SelectTrigger size="sm" className="w-[11rem]" aria-label={t("folder_file_into")}>
                <SelectValue placeholder={t("folder_file_into")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("folder_remove_from")}</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setDialog("delete")}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t("action_delete")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("bulk_clear")}
            onClick={() => selection.clear()}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={dialog === "move"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bulk_move_title", { count })}</DialogTitle>
            <DialogDescription>{t("bulk_move_help")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("move_type")}</Label>
              <Select value={moveType} onValueChange={onTypeChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">{t("bulk_keep")}</SelectItem>
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
                    <SelectItem value="keep">{t("bulk_keep")}</SelectItem>
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
                    <SelectItem value="keep">{t("bulk_keep")}</SelectItem>
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
            <Button
              onClick={submitMove}
              disabled={
                pending ||
                (moveType === "keep" && moveYear === "keep" && moveCategory === "keep")
              }
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bulk_delete_title", { count })}</DialogTitle>
            <DialogDescription>{t("bulk_delete_help", { count })}</DialogDescription>
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
