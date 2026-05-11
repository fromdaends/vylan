import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { CsvImportClient } from "./csv-import-client";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Clients");

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/clients"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-3.5" />
        {t("back_to_list")}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("import_title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("import_subtitle")}
        </p>
      </header>
      <CsvImportClient locale={locale} />
    </div>
  );
}
