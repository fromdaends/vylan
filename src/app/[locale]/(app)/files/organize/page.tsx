import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { assertLocale } from "@/lib/locale";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  listOpenSuggestions,
  type OpenSuggestion,
  type OrganizeBucket,
} from "@/lib/files/organize";
import {
  BulkApproveButton,
  OrganizeRow,
  ScanNowButton,
  type ReviewRow,
} from "@/components/files/organize-review";
import { DOC_TYPE_LABELS, docTypeGroupLabel } from "@/lib/doc-types";
import { isBrowseCategory } from "@/lib/files/axes";

// AI ORGANIZE — the review queue (Files v2 §3). Everything on this page is a
// PROPOSAL until a human clicks approve; the page itself changes nothing.
export const dynamic = "force-dynamic";

const BUCKET_ORDER: OrganizeBucket[] = [
  "filing",
  "misfile",
  "duplicate",
  "low_confidence",
  "unprocessed",
];

export default async function OrganizePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Files");

  const { suggestions, available } = await listOpenSuggestions();

  // Client names, one query.
  let clientNames = new Map<string, string>();
  if (suggestions.length > 0) {
    const sb = await getServerSupabase();
    const ids = [...new Set(suggestions.map((s) => s.clientId))];
    const { data } = await sb.from("clients").select("id, display_name").in("id", ids);
    clientNames = new Map(
      ((data ?? []) as Array<{ id: string; display_name: string }>).map((c) => [
        c.id,
        c.display_name,
      ]),
    );
  }

  const typeLabel = (code: string | null | undefined): string | null =>
    code && code in DOC_TYPE_LABELS
      ? DOC_TYPE_LABELS[code as keyof typeof DOC_TYPE_LABELS][locale].split(" — ")[0]
      : null;
  const categoryLabel = (code: string | null | undefined): string | null =>
    code && isBrowseCategory(code) ? docTypeGroupLabel(code, locale) : null;

  const describe = (parts: Array<string | null>): string => {
    const real = parts.filter((p): p is string => !!p);
    return real.length > 0 ? real.join(" · ") : t("unsorted");
  };

  const toRow = (s: OpenSuggestion): ReviewRow => {
    const current = describe([
      typeLabel(s.currentState.doc_type),
      s.currentState.year != null ? String(s.currentState.year) : null,
      categoryLabel(s.currentState.category),
    ]);
    const folderName = (s.proposedState.folder_name as string | null) ?? null;
    const proposed =
      s.bucket === "duplicate"
        ? t("organize_proposed_delete")
        : describe([
            typeLabel((s.proposedState.doc_type as string | null) ?? null),
            s.proposedState.year != null ? String(s.proposedState.year) : null,
            categoryLabel((s.proposedState.category as string | null) ?? null),
            folderName ? t("organize_into_folder", { name: folderName }) : null,
          ]);
    return {
      id: s.id,
      bucket: s.bucket,
      name: s.currentState.name,
      clientName: clientNames.get(s.clientId) ?? "—",
      currentLabel: current,
      proposedLabel: proposed,
      reasoning: s.reasoning,
      previewUrl: `/api/files/${s.documentId}?source=${s.source}`,
    };
  };

  const byBucket = new Map<OrganizeBucket, ReviewRow[]>();
  for (const s of suggestions) {
    const list = byBucket.get(s.bucket) ?? [];
    list.push(toRow(s));
    byBucket.set(s.bucket, list);
  }

  return (
    <div className="mx-auto w-full max-w-4xl animate-in-fade">
      <header className="mb-6">
        <Link
          href="/files"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("organize_back")}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="size-5 text-accent" aria-hidden />
            {t("organize_title")}
          </h1>
          <ScanNowButton />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("organize_subtitle")}
        </p>
      </header>

      {!available || suggestions.length === 0 ? (
        <div className="rounded-lg border border-border/70 bg-card px-4 py-14 text-center">
          <p className="text-sm font-medium">{t("organize_all_clear")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("organize_all_clear_body")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKET_ORDER.map((bucket) => {
            const rows = byBucket.get(bucket) ?? [];
            if (rows.length === 0) return null;
            const confirmLabel =
              bucket === "duplicate"
                ? t("organize_bulk_confirm_delete", { count: rows.length })
                : t("organize_bulk_confirm_move", { count: rows.length });
            return (
              <section
                key={bucket}
                className="rounded-lg border border-border/70 bg-card"
              >
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                  <h2 className="text-sm font-medium">
                    {t(`organize_bucket_${bucket}`)}{" "}
                    <span className="text-muted-foreground">({rows.length})</span>
                  </h2>
                  <BulkApproveButton
                    bucket={bucket}
                    count={rows.length}
                    confirmLabel={confirmLabel}
                  />
                </div>
                <ul className="divide-y divide-border/50">
                  {rows.map((row) => (
                    <OrganizeRow key={row.id} row={row} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
