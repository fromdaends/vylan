"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDate, type AppLocale } from "@/lib/format";
import { restoreDocumentAction } from "@/app/actions/documents";
import type { DeletedDocument } from "@/lib/db/documents";

// The recycle bin. Same list chrome as the browser itself, with Restore in
// place of the actions menu.
//
// Every row states WHEN it was deleted rather than when it will be purged: the
// firm knows the window is 30 days (it is on the header), and a countdown to
// permanent erasure is a scarier thing to put on a screen than it is a useful
// one.
export function RecentlyDeleted({
  documents,
  locale,
  retentionDays,
}: {
  documents: DeletedDocument[];
  locale: AppLocale;
  retentionDays: number;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function restore(doc: DeletedDocument) {
    setBusy(`${doc.source}-${doc.id}`);
    startTransition(async () => {
      const res = await restoreDocumentAction({ source: doc.source, id: doc.id });
      setBusy(null);
      if (res.ok) {
        router.refresh();
        toast.success(t("restore_done", { name: doc.name }));
      } else {
        toast.error(t("action_failed"));
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("bin_intro", { days: retentionDays })}
      </p>

      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
          <Trash2 className="mx-auto size-7 text-muted-foreground/50" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">{t("bin_empty")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="min-w-0 flex-1">{t("col_name")}</span>
            <span className="hidden w-40 shrink-0 sm:block">{t("col_client")}</span>
            <span className="hidden w-20 shrink-0 text-right sm:block">
              {t("col_size")}
            </span>
            <span className="w-24 shrink-0 text-right">{t("col_deleted")}</span>
            <span className="w-24 shrink-0" aria-hidden />
          </div>
          <ul className="divide-y divide-border/50">
            {documents.map((doc) => {
              const key = `${doc.source}-${doc.id}`;
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Trash2
                      className="size-[18px] shrink-0 text-muted-foreground/60"
                      aria-hidden
                    />
                    <span className="truncate text-sm">{doc.name}</span>
                  </span>
                  <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">
                    {doc.clientName}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:block">
                    {formatBytes(doc.sizeBytes)}
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {formatDate(doc.deletedAt, locale, "short")}
                  </span>
                  <span className="w-24 shrink-0 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      disabled={pending && busy === key}
                      onClick={() => restore(doc)}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      {t("action_restore")}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
