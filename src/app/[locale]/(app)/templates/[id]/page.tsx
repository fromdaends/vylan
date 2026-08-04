import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTemplate } from "@/lib/db/templates";
import { listAutomations } from "@/lib/db/automations";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { TemplateEditor } from "@/components/templates/template-editor";
import { TemplateDetailShell } from "@/components/templates/template-detail-shell";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { cleanLabel } from "@/lib/text/clean-label";
import { assertLocale } from "@/lib/locale";
import { Breadcrumb } from "@/components/ui/breadcrumb";

// The template's own page. Two shapes, by the Part A switch:
//
//   * workflows ON — the founder's sketch: boxed sidebar (Documents ·
//     Automation · Tasks · Assignees), the whole playbook editable here, and
//     BUILT-INS open too (read-only, Clone to customize) so their ready-made
//     flows are inspectable before cloning.
//   * workflows OFF — exactly the page that existed before 1560: the firm's
//     own checklist editor, built-ins 404. No firm sees a change it didn't
//     turn on.
export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const tmpl = await getTemplate(id);
  if (!tmpl) notFound();

  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm || !user) return null; // signed-out render race — the layout redirects
  const workflowsOn =
    (firm as { workflows_enabled?: boolean }).workflows_enabled === true;

  const t = await getTranslations("Templates");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  const displayName = cleanLabel(localizedTemplateName(tmpl, locale));

  if (!workflowsOn) {
    // Pre-1560 behaviour, byte for byte: firm templates only.
    if (tmpl.firm_id == null) notFound();
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
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

  const [automations, members] = await Promise.all([
    listAutomations(),
    listActiveFirmUsers(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_templates"), href: "/templates" },
          { label: displayName },
        ]}
      />
      <TemplateDetailShell
        template={tmpl}
        displayName={displayName}
        automations={automations.map((a) => ({
          id: a.id,
          firmId: a.firmId,
          name: a.name,
          definition: a.definition,
        }))}
        members={members.map((m) => ({
          id: m.id,
          name: m.display_name ?? m.name,
        }))}
        locale={locale}
      />
    </div>
  );
}
