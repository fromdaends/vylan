"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { formatBytes } from "@/lib/format";
import { computeContentHashWeb } from "@/lib/files/content-hash-web";
import { MAX_BYTES } from "@/lib/files/upload-limits";
import {
  createImportUploadSlotAction,
  finishImportRunAction,
  recordImportedFileAction,
  startImportRunAction,
} from "@/app/actions/document-import";

// QUICK UPLOAD (Files v2 §7) — the two-step path: pick files, pick a client,
// done. The import WIZARD stays for the real migration case (a whole folder
// tree mapped to many clients); this is for "the client just handed me three
// PDFs". Same machinery underneath — same run/slot/record actions, so the
// same dedupe-by-content-hash and the same audit trail — just none of the
// folder-mapping ceremony.
//
// Files land as IMPORTED documents: firm-only by default, and never sent to
// any AI (the founder's rate-limit ruling — only portal intake reads files).

export function QuickUpload({
  clients,
  defaultClientId,
  externalOpen,
  onExternalOpenChange,
  initialFiles,
}: {
  clients: { id: string; name: string }[];
  /** Browsing inside a client pre-answers the only question this asks. */
  defaultClientId: string | null;
  externalOpen: boolean;
  onExternalOpenChange: (open: boolean) => void;
  /**
   * Files the caller already has in hand — the Home dropzone passes what was
   * dropped on it. Without this the drop would open an empty picker and ask
   * the user to find the same files again, which is not what "drop files here"
   * promises. Seeded once per open; the picker still works normally after.
   */
  initialFiles?: File[] | null;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [clientId, setClientId] = useState<string>(defaultClientId ?? "");
  const [picked, setPicked] = useState<{ name: string; size: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
  } | null>(null);
  // Same trick as the wizard: File objects stay out of React state.
  const filesRef = useRef<File[]>([]);

  const oversize = picked.filter((f) => f.size > MAX_BYTES).length;
  const uploadable = picked.length - oversize;

  // Adopt dropped files when the dialog is opened with some. Keyed on the
  // array identity the caller hands over, so re-renders don't re-seed and a
  // second drop of the same filenames still registers.
  //
  // This genuinely IS prop-into-state sync, which the lint rule is right to
  // flag in general: File objects cannot live in state (they are not
  // serializable and the upload loop needs the real handles from filesRef),
  // and the dialog is opened by a CONTROLLED prop, so Radix's onOpenChange
  // never fires on the way in and there is no event handler to seed from.
  // The dependency is the array identity, so this runs once per drop.
  useEffect(() => {
    if (!initialFiles || initialFiles.length === 0) return;
    filesRef.current = initialFiles;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setPicked(initialFiles.map((f) => ({ name: f.name, size: f.size })));
  }, [initialFiles]);

  function reset() {
    setPicked([]);
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setClientId(defaultClientId ?? "");
    filesRef.current = [];
  }

  async function run() {
    const files = filesRef.current.filter((f) => f.size <= MAX_BYTES);
    if (!clientId || files.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    const started = await startImportRunAction({ totalCount: files.length });
    if (!started.ok) {
      toast.error(t("action_failed"));
      setBusy(false);
      return;
    }

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { name: string; reason: string }[] = [];
    for (const file of files) {
      try {
        const slot = await createImportUploadSlotAction({
          runId: started.runId,
          clientId,
          filename: file.name,
        });
        if (!slot.ok) throw new Error(slot.error);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const put = await fetch(slot.signedUrl, {
          method: "PUT",
          body: bytes,
          headers: { "content-type": file.type || "application/octet-stream" },
        });
        if (!put.ok) throw new Error(`upload_${put.status}`);
        const rec = await recordImportedFileAction({
          runId: started.runId,
          clientId,
          storagePath: slot.path,
          originalFilename: file.name,
          sourcePath: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          contentHash: await computeContentHashWeb(bytes),
        });
        if (!rec.ok) throw new Error(rec.error);
        if (rec.skipped === "duplicate") skipped++;
        else imported++;
      } catch (e) {
        failed++;
        failures.push({
          name: file.name,
          reason: e instanceof Error ? e.message : "failed",
        });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    await finishImportRunAction({
      runId: started.runId,
      imported,
      skipped,
      failed,
      failures,
    });
    setResult({ imported, skipped, failed });
    setBusy(false);
    router.refresh();
  }

  return (
    <Dialog
      open={externalOpen}
      onOpenChange={(o) => {
        if (!o && busy) return;
        onExternalOpenChange(o);
        if (o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("upload_title")}</DialogTitle>
          <DialogDescription>{t("upload_intro")}</DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 px-6 py-8 text-center transition-colors hover:bg-muted/40">
              <Upload className="size-6 text-muted-foreground/60" aria-hidden />
              <span className="text-sm font-medium">
                {picked.length > 0
                  ? t("upload_picked", { count: picked.length })
                  : t("upload_pick")}
              </span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length === 0) return;
                  filesRef.current = list;
                  setPicked(list.map((f) => ({ name: f.name, size: f.size })));
                }}
              />
            </label>
            {picked.length > 0 && (
              <ul className="max-h-36 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {picked.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex justify-between gap-3">
                    <span className={f.size > MAX_BYTES ? "line-through" : "truncate"}>
                      {f.name}
                    </span>
                    <span className="shrink-0">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
            {oversize > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("import_skipping", { count: oversize })}
              </p>
            )}
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("import_choose_client")} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {busy && (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <p className="text-sm font-medium">
              {t("import_done", { count: result.imported })}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {result.skipped > 0 && (
                <li>{t("import_done_skipped", { count: result.skipped })}</li>
              )}
              {result.failed > 0 && (
                <li className="text-destructive">
                  {t("import_done_failed", { count: result.failed })}
                </li>
              )}
            </ul>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <Button onClick={run} disabled={busy || !clientId || uploadable === 0}>
              {t("upload_start", { count: uploadable })}
            </Button>
          ) : (
            <Button onClick={() => onExternalOpenChange(false)}>
              {t("import_close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
