import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FileText } from "lucide-react";
import { getClientArchive } from "@/lib/db/client-archive";
import { assertLocale } from "@/lib/locale";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ArchiveDownloadZipButton } from "@/components/clients/client-archive/download-zip-button";
import { ClientArchiveView } from "@/components/clients/client-archive/client-archive-view";

// The archive reads live document data, so never serve a stale snapshot after a
// new upload / deliverable / signature.
export const dynamic = "force-dynamic";

export default async function ClientArchivePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const archive = await getClientArchive(id, locale);
  if (!archive) notFound();

  const t = await getTranslations("Archive");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_clients"), href: "/clients" },
          { label: archive.client.displayName, href: `/clients/${archive.client.id}` },
          { label: t("title") },
        ]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="pt-1 text-sm text-foreground">
            <span className="font-medium">{archive.client.displayName}</span>
            <span className="text-muted-foreground">
              {" · "}
              {t("total_files", { count: archive.totalFiles })}
            </span>
          </p>
        </div>
        {archive.totalFiles > 0 && (
          <ArchiveDownloadZipButton
            endpoint={`/api/clients/${archive.client.id}/archive`}
            label={t("download_everything")}
            preparingLabel={t("preparing")}
            emptyLabel={t("download_empty")}
            failedLabel={t("download_failed")}
            tooLargeLabel={t("download_too_large")}
            variant="default"
          />
        )}
      </header>

      <ClientArchiveView archive={archive} locale={locale} />
    </div>
  );
}
