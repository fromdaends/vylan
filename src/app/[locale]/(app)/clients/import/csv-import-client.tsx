"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseClientCsv, type ImportParseResult } from "@/lib/csv";
import {
  importAndRedirect,
  type ImportPreviewRow,
} from "@/app/actions/clients";
import { usePathname } from "@/i18n/navigation";

const SAMPLE_CSV = `name,email,phone,type,language
Boulangerie Lévis Inc.,compta@boulangerie.example,4185551111,business,fr
Marie Tremblay,marie@example.com,5145551234,individual,fr
Northern Lights Co.,billing@northern.example,4165551122,business,en`;

export function CsvImportClient({ locale }: { locale: "fr" | "en" }) {
  const t = useTranslations("Clients");
  const tc = useTranslations("Common");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportParseResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  void pathname;

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsv(text);
      setPreview(parseClientCsv(text));
    };
    reader.readAsText(file);
  }

  function previewNow() {
    setPreview(parseClientCsv(csv));
  }

  function commit() {
    if (!preview || preview.valid.length === 0) return;
    setSubmitError(null);
    startTransition(async () => {
      try {
        const rows: ImportPreviewRow[] = preview.valid;
        await importAndRedirect(rows, locale);
        // server redirect handles navigation; client only reaches here on error
      } catch {
        // Localized message — never the raw "commit_failed" code.
        setSubmitError(t("import_commit_failed"));
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("import_paste_title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={SAMPLE_CSV}
            rows={10}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="sr-only">{t("import_upload")}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                className="text-sm"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={previewNow}
              disabled={!csv.trim()}
            >
              {t("import_preview")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCsv(SAMPLE_CSV);
                setPreview(parseClientCsv(SAMPLE_CSV));
              }}
            >
              {t("import_load_sample")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("import_columns_hint")}
          </p>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {t("import_preview_title")}
              <Badge variant="secondary">
                {preview.valid.length} {t("import_valid")}
              </Badge>
              {preview.invalid.length > 0 && (
                <Badge variant="outline">
                  {preview.invalid.length} {t("import_invalid")}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.headerWarnings.length > 0 && (
              <Alert>
                <AlertDescription>
                  {preview.headerWarnings.map((w) => (
                    <div key={w} className="text-xs font-mono">
                      ⚠ {w}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            {preview.valid.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("col_name")}</TableHead>
                      <TableHead>{t("col_type")}</TableHead>
                      <TableHead>{t("col_email")}</TableHead>
                      <TableHead>{t("col_phone")}</TableHead>
                      <TableHead>{t("col_locale")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.valid.slice(0, 50).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {row.display_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {row.type === "individual"
                              ? t("type_individual")
                              : t("type_business")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {row.phone ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.locale}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {preview.valid.length > 50 && (
                  <div className="border-t border-border p-3 text-xs text-muted-foreground bg-muted">
                    +{preview.valid.length - 50} {t("import_more_rows")}
                  </div>
                )}
              </div>
            )}

            {preview.invalid.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {t("import_invalid_intro")}:
                <ul className="mt-1.5 space-y-1 font-mono">
                  {preview.invalid.slice(0, 20).map((r) => (
                    <li key={r.row}>
                      {t("import_row_label", { row: r.row })} — {r.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={commit}
                disabled={pending || preview.valid.length === 0}
              >
                {pending
                  ? tc("saving")
                  : t("import_commit", { count: preview.valid.length })}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setCsv("");
                  router.refresh();
                }}
                disabled={pending}
              >
                {tc("cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
