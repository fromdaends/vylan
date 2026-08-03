"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FolderUp, Upload } from "lucide-react";
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
import {
  AUTO_MATCH_CONFIDENCE,
  matchFolderToClient,
  planImport,
  type DroppedFile,
  type FolderGroup,
} from "@/lib/files/import-plan";
import { MAX_BYTES } from "@/lib/files/upload-limits";
import {
  createImportUploadSlotAction,
  finishImportRunAction,
  recordImportedFileAction,
  startImportRunAction,
} from "@/app/actions/document-import";

// THE IMPORT WIZARD — the one way documents enter Vylan outside the
// engagement/portal pipeline, and deliberately not a general upload button.
// Four steps: choose a folder, confirm what was found, map folders to clients,
// review and run.
//
// "SKIP" is a first-class mapping choice. The spec's hard rule is that nothing
// imports without an explicit client, so a folder left unmapped blocks the run
// rather than quietly defaulting to anything.

type Step = "source" | "map" | "run";

type Mapping = Record<string, string>; // folder -> clientId | "skip"

export function ImportWizard({
  clients,
  externalOpen,
  onExternalOpenChange,
}: {
  clients: { id: string; name: string }[];
  /** Drive-style "+ New" menu drives the wizard from outside; when these are
   * provided the wizard renders NO button of its own. */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("source");
  const [groups, setGroups] = useState<FolderGroup[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
    failures: { name: string; reason: string }[];
  } | null>(null);

  // The actual File objects, kept out of React state: they are large, never
  // rendered, and putting them in state would re-serialize them on every
  // keystroke in the mapping step.
  const filesRef = useRef<Map<string, File>>(new Map());

  const reset = useCallback(() => {
    setStep("source");
    setGroups([]);
    setMapping({});
    setProgress({ done: 0, total: 0 });
    setResult(null);
    filesRef.current = new Map();
  }, []);

  function onPick(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const dropped: DroppedFile[] = [];
    const map = new Map<string, File>();
    for (const f of Array.from(fileList)) {
      // webkitRelativePath is what carries the folder structure from a
      // directory picker; without it there is no folder to map to a client.
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      dropped.push({ path, name: f.name, size: f.size, mimeType: f.type });
      map.set(path, f);
    }
    filesRef.current = map;
    const planned = planImport(dropped, MAX_BYTES);
    setGroups(planned);

    // Pre-fill the mapping with confident matches only. Everything else stays
    // blank so the person has to look at it.
    const next: Mapping = {};
    for (const g of planned) {
      const m = matchFolderToClient(g.folder, clients);
      if (m.clientId && m.confidence >= AUTO_MATCH_CONFIDENCE) {
        next[g.folder] = m.clientId;
      }
    }
    setMapping(next);
    setStep("map");
  }

  const totals = useMemo(() => {
    let files = 0;
    let bytes = 0;
    let skipped = 0;
    for (const g of groups) {
      const target = mapping[g.folder];
      skipped += g.skipped;
      if (!target || target === "skip") continue;
      files += g.count;
      bytes += g.bytes;
    }
    return { files, bytes, skipped };
  }, [groups, mapping]);

  const unmapped = groups.filter((g) => !mapping[g.folder]).length;

  async function run() {
    setBusy(true);
    setStep("run");
    const started = await startImportRunAction({ totalCount: totals.files });
    if (!started.ok) {
      toast.error(t("action_failed"));
      setBusy(false);
      return;
    }

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { name: string; reason: string }[] = [];
    setProgress({ done: 0, total: totals.files });

    for (const group of groups) {
      const clientId = mapping[group.folder];
      if (!clientId || clientId === "skip") continue;
      for (const planned of group.files) {
        if (planned.skip) continue;
        const file = filesRef.current.get(planned.path);
        if (!file) {
          failed++;
          failures.push({ name: planned.name, reason: "missing" });
          continue;
        }
        try {
          const slot = await createImportUploadSlotAction({
            runId: started.runId,
            clientId,
            filename: planned.name,
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
            originalFilename: planned.name,
            sourcePath: planned.path,
            mimeType: file.type,
            sizeBytes: file.size,
            contentHash: await computeContentHashWeb(bytes),
          });
          if (!rec.ok) throw new Error(rec.error);
          if (rec.skipped === "duplicate") skipped++;
          else imported++;
        } catch (e) {
          failed++;
          // Named, per file — "some files failed" with no names is useless to
          // someone who has to decide what to do about it.
          failures.push({
            name: planned.name,
            reason: e instanceof Error ? e.message : "failed",
          });
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }

    await finishImportRunAction({
      runId: started.runId,
      imported,
      skipped,
      failed,
      failures,
    });
    setResult({ imported, skipped, failed, failures });
    setBusy(false);
    router.refresh();
  }

  const controlled = externalOpen !== undefined;
  const isOpen = controlled ? externalOpen : open;
  const setOpenBoth = (o: boolean) => {
    if (controlled) onExternalOpenChange?.(o);
    else setOpen(o);
    if (o) reset();
  };

  return (
    <>
      {!controlled && (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <FolderUp className="size-4" aria-hidden />
        {t("import_button")}
      </Button>
      )}

      <Dialog
        open={isOpen}
        onOpenChange={(o) => {
          // Never let a click-away abandon an import mid-flight: the files live
          // in this tab, so closing really does stop it.
          if (!o && busy) return;
          if (controlled) onExternalOpenChange?.(o);
          else setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("import_title")}</DialogTitle>
            <DialogDescription>
              {step === "source" ? t("import_intro") : t("import_intro_short")}
            </DialogDescription>
          </DialogHeader>

          {step === "source" && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 px-6 py-12 text-center transition-colors hover:bg-muted/40">
                <Upload className="size-7 text-muted-foreground/60" aria-hidden />
                <span className="text-sm font-medium">{t("import_pick")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("import_pick_hint")}
                </span>
                <input
                  type="file"
                  multiple
                  // Directory selection is what gives us folder names to map to
                  // clients. These attributes are non-standard but supported in
                  // every browser this product targets.
                  {...{ webkitdirectory: "", directory: "" }}
                  className="sr-only"
                  onChange={(e) => onPick(e.target.files)}
                />
              </label>
              <p className="text-xs text-muted-foreground">{t("import_types")}</p>
            </div>
          )}

          {step === "map" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("import_found", {
                  files: groups.reduce((a, g) => a + g.count, 0),
                  folders: groups.length,
                })}
                {totals.skipped > 0 ? ` · ${t("import_skipping", { count: totals.skipped })}` : ""}
              </p>
              <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <div
                    key={g.folder || "(root)"}
                    className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {g.folder || t("import_loose_files")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("import_group_meta", {
                          count: g.count,
                          size: formatBytes(g.bytes),
                        })}
                      </span>
                    </span>
                    <Select
                      value={mapping[g.folder] ?? ""}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [g.folder]: v }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-[15rem]">
                        <SelectValue placeholder={t("import_choose_client")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">{t("import_skip_folder")}</SelectItem>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {unmapped > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("import_unmapped", { count: unmapped })}
                </p>
              )}
            </div>
          )}

          {step === "run" && (
            <div className="space-y-3 py-2">
              {!result ? (
                <>
                  <p className="text-sm">
                    {t("import_running", {
                      done: progress.done,
                      total: progress.total,
                    })}
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("import_keep_open")}
                  </p>
                </>
              ) : (
                <>
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
                  {result.failures.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border/70 p-2 text-xs">
                      {result.failures.map((f, i) => (
                        <div key={`${f.name}-${i}`} className="truncate">
                          {f.name} — {f.reason}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("import_next_step")}
                  </p>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {step === "map" && (
              <>
                <Button variant="ghost" onClick={() => setStep("source")}>
                  {t("import_back")}
                </Button>
                <Button
                  onClick={run}
                  // Nothing imports without an explicit mapping for every
                  // folder — the spec's hard rule, enforced here.
                  disabled={unmapped > 0 || totals.files === 0}
                >
                  {t("import_start", { count: totals.files })}
                </Button>
              </>
            )}
            {step === "run" && result && (
              <Button onClick={() => setOpen(false)}>{t("import_close")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
