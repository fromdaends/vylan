"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  importFromSessionAndRedirect,
  type ImportPreviewRow,
} from "@/app/actions/clients";
import type { ImportCandidate } from "@/lib/db/client-import";

// Review step of the bookkeeping import: the staged customer list with a
// checkbox per row. Candidates whose name already matches a Vylan client come
// UNCHECKED with an "already in Vylan" badge (import them anyway by checking);
// everyone else is pre-checked. Confirming creates the clients through the same
// validated bulk path the CSV import uses, then lands on the client list.
export function BookkeepingImportReview({
  sessionId,
  sourceName,
  candidates,
  existingNames,
  defaultClientLocale,
  locale,
}: {
  sessionId: string;
  sourceName: string | null;
  candidates: ImportCandidate[];
  // Normalized (lowercased, trimmed) display names of the firm's existing
  // clients, for the duplicate hint.
  existingNames: string[];
  defaultClientLocale: "fr" | "en";
  locale: "fr" | "en";
}) {
  const t = useTranslations("Clients");
  const existing = useMemo(() => new Set(existingNames), [existingNames]);
  const [checked, setChecked] = useState<boolean[]>(() =>
    candidates.map((c) => !existing.has(c.display_name.trim().toLowerCase())),
  );
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedCount = checked.filter(Boolean).length;

  function commit() {
    if (selectedCount === 0) return;
    setSubmitError(null);
    const rows: ImportPreviewRow[] = candidates
      .filter((_, i) => checked[i])
      .map((c) => ({
        display_name: c.display_name,
        email: c.email,
        phone: c.phone,
        // Businesses invoice through the books; the accountant can flip any
        // individual on their client page afterwards.
        type: "business",
        locale: defaultClientLocale,
        external_ref: null,
        notes: null,
      }));
    startTransition(async () => {
      try {
        await importFromSessionAndRedirect(sessionId, rows, locale);
      } catch (e) {
        // redirect() throws internally on success — only surface real errors.
        if ((e as Error | null)?.message === "NEXT_REDIRECT") throw e;
        setSubmitError(
          (e as Error | null)?.message === "session_gone"
            ? t("bk_import_session_gone")
            : t("import_commit_failed"),
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("bk_import_review_title")}
        </CardTitle>
        {sourceName && (
          <p className="text-sm text-muted-foreground">
            {t("bk_import_review_from", { source: sourceName })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-h-96 overflow-y-auto rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>{t("bk_import_col_name")}</TableHead>
                <TableHead>{t("bk_import_col_email")}</TableHead>
                <TableHead>{t("bk_import_col_phone")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((c, i) => {
                const dup = existing.has(c.display_name.trim().toLowerCase());
                return (
                  <TableRow key={i} className={dup ? "opacity-60" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={checked[i] ?? false}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const next = [...prev];
                            next[i] = e.target.checked;
                            return next;
                          })
                        }
                        aria-label={c.display_name}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {c.display_name}
                        {dup && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t("bk_import_exists")}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.email ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.phone ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button
            onClick={commit}
            disabled={pending || selectedCount === 0}
            aria-busy={pending}
          >
            {pending ? "…" : t("import_commit", { count: selectedCount })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
