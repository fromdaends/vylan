import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTemplate } from "@/lib/db/templates";
import { TemplateEditor } from "@/components/templates/template-editor";
import { assertLocale } from "@/lib/locale";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const tmpl = await getTemplate(id);
  if (!tmpl || tmpl.firm_id == null) notFound();
  // Built-in templates can't be edited directly; they must be cloned first.

  const t = await getTranslations("Templates");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="space-y-6 max-w-3xl">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_templates"), href: "/templates" },
          { label: tmpl.name },
        ]}
      />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("edit_title")}
        </h1>
      </header>
      <TemplateEditor template={tmpl} locale={locale} />
    </div>
  );
}
