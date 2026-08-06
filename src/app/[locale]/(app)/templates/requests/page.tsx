import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  listTemplates,
  BLANK_TEMPLATE_ID,
  type Template,
} from "@/lib/db/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { Button } from "@/components/ui/button";
import { Plus, FilePlus2 } from "lucide-react";
import { assertLocale } from "@/lib/locale";
import { getCurrentFirm } from "@/lib/db/firms";
import { buildWorkflowSummaryLine } from "@/lib/workflow/summary";
import { parseWorkflowDefinition } from "@/lib/workflow/definition";
import { RequestTemplateRow } from "@/components/templates/request-template-row";
import { SearchableTemplates } from "@/components/templates/searchable-templates";
import { createBlankTemplateAction } from "@/app/actions/templates";
import {
  TemplatesPageShell,
  EmptyState,
} from "@/components/templates/templates-chrome";

/**
 * Client requests — what you ask a client to send you. Canopy's name for these
 * is "Client Request templates"; this repo's table is `templates` (0001).
 *
 * The one page of the four that keeps INNER sections, because the split here is
 * real and not cosmetic: the built-ins ship with Vylan and can only be cloned,
 * the firm's own can be edited and deleted. Collapsing them into one grid would
 * mean a card whose available actions depend on an invisible property.
 */
export default async function RequestTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [templates, currentFirm] = await Promise.all([
    listTemplates(),
    getCurrentFirm(),
  ]);

  // Part A switch (1560): with it on, template cards open their detail page
  // (built-ins read-only) and carry a one-line automation summary.
  const workflowsOn =
    (currentFirm as { workflows_enabled?: boolean } | null)
      ?.workflows_enabled === true;

  // Hide the empty "blank" built-in — it's only the clone source for
  // "New template", never a template a firm should pick.
  const builtIn = templates.filter(
    (tmpl) => tmpl.firm_id == null && tmpl.id !== BLANK_TEMPLATE_ID,
  );
  const firm = templates.filter((tmpl) => tmpl.firm_id != null);

  const t = await getTranslations("Templates");
  const tAuto = await getTranslations("Automations");


  // Cards are BUILT HERE (server actions must live in real <form>s) and handed
  // to the search component as nodes plus the words each card should be
  // findable by — its name and what it asks the client for.
  const terms = (tmpl: Template) =>
    [
      localizedTemplateName(tmpl, locale),
      ...tmpl.items.map((it) => (locale === "fr" ? it.label_fr : it.label_en)),
    ].join(" ");

  // The one line under each name — what it asks for, and how many are
  // required. Built here so the server does the counting.
  const metaFor = (tmpl: Template) => {
    const parts = [t("documents_count", { count: tmpl.items.length })];
    const required = tmpl.items.filter((it) => it.required).length;
    if (required > 0) parts.push(t("required_count", { count: required }));
    const preview = tmpl.items
      .slice(0, 3)
      .map((it) => (locale === "fr" ? it.label_fr : it.label_en))
      .filter(Boolean);
    if (preview.length > 0) parts.push(preview.join(" \u00b7 "));
    // The one-line automation summary from #1337. It used to sit on the card
    // with its own icon; the row has one meta line, so it joins the end rather
    // than being dropped — that feature is another session's and still live.
    const workflowDef = workflowsOn ? parseWorkflowDefinition(tmpl.workflow) : null;
    if (workflowDef) {
      const summary = buildWorkflowSummaryLine(workflowDef, tAuto);
      if (summary) parts.push(summary);
    }
    return parts.join(" \u2014 ");
  };

  const rowFor = (tmpl: Template, builtin: boolean) => ({
    id: tmpl.id,
    terms: terms(tmpl),
    node: (
      <RequestTemplateRow
        key={tmpl.id}
        id={tmpl.id}
        name={localizedTemplateName(tmpl, locale)}
        type={tmpl.type}
        meta={metaFor(tmpl)}
        builtin={builtin}
        locale={locale}
      />
    ),
  });

  const yoursCards = firm.map((tmpl) => rowFor(tmpl, false));
  const builtInCards = builtIn.map((tmpl) => rowFor(tmpl, true));

  return (
    <TemplatesPageShell>
      <SearchableTemplates
        title={t("section_document_requests")}
        subtitle={t("document_requests_subtitle")}
        action={
          <form action={createBlankTemplateAction}>
            <input type="hidden" name="__app_locale" value={locale} />
            <Button
              type="submit"
              className="h-[42px] gap-2 rounded-[11px] px-5 text-[14.5px] font-semibold shadow-[0_4px_14px_oklch(0.55_0.18_258_/_0.28)]"
            >
              <Plus className="size-[18px]" />
              {t("templates_new")}
            </Button>
          </form>
        }
        sections={[
          {
            key: "firm",
            primary: true,
            title: t("section_firm"),
            cards: yoursCards,
            empty: (
              <EmptyState>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <FilePlus2 className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">
                  {t("firm_empty")}
                </p>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                  {t("templates_new_hint")}
                </p>
                <form action={createBlankTemplateAction}>
                  <input type="hidden" name="__app_locale" value={locale} />
                  <Button type="submit" size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    {t("templates_new")}
                  </Button>
                </form>
              </EmptyState>
            ),
          },
          { key: "builtin", title: t("section_builtin"), cards: builtInCards },
        ]}
      />
    </TemplatesPageShell>
  );
}
