import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  listTemplates,
  BLANK_TEMPLATE_ID,
  type Template,
} from "@/lib/db/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Plus, FilePlus2 } from "lucide-react";
import { assertLocale } from "@/lib/locale";
import { getCurrentFirm } from "@/lib/db/firms";
import { buildWorkflowSummaryLine } from "@/lib/workflow/summary";
import { parseWorkflowDefinition } from "@/lib/workflow/definition";
import { TemplateCard } from "@/components/templates/template-card";
import { SearchableTemplates } from "@/components/templates/searchable-templates";
import { AutoNewTemplate } from "@/components/templates/auto-new-template";
import {
  cloneTemplateAction,
  createBlankTemplateAction,
  deleteTemplateAction,
} from "@/app/actions/templates";
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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `?new=1` from the + Create panel clones the blank and opens its editor. */
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

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

  const cardData = (tmpl: Template) => {
    const preview = tmpl.items
      .slice(0, 3)
      .map((it) => (locale === "fr" ? it.label_fr : it.label_en));
    const requiredCount = tmpl.items.filter((it) => it.required).length;
    const workflowDef = workflowsOn
      ? parseWorkflowDefinition(tmpl.workflow)
      : null;
    return {
      name: localizedTemplateName(tmpl, locale),
      type: tmpl.type,
      itemCount: tmpl.items.length,
      requiredCount,
      preview,
      workflowSummary: workflowDef
        ? buildWorkflowSummaryLine(workflowDef, tAuto)
        : null,
    };
  };

  // Cards are BUILT HERE (server actions must live in real <form>s) and handed
  // to the search component as nodes plus the words each card should be
  // findable by — its name and what it asks the client for.
  const terms = (tmpl: Template) =>
    [
      localizedTemplateName(tmpl, locale),
      ...tmpl.items.map((it) => (locale === "fr" ? it.label_fr : it.label_en)),
    ].join(" ");

  const yoursCards = firm.map((tmpl) => ({
    id: tmpl.id,
    terms: terms(tmpl),
    node: (
      <TemplateCard
        key={tmpl.id}
        {...cardData(tmpl)}
        href={workflowsOn ? `/templates/${tmpl.id}` : undefined}
        footer={
          <>
            <form action={deleteTemplateAction}>
              <input type="hidden" name="id" value={tmpl.id} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
              >
                {t("delete")}
              </Button>
            </form>
            <Link href={`/templates/${tmpl.id}`}>
              <Button size="sm" variant="secondary">
                {t("edit")}
              </Button>
            </Link>
          </>
        }
      />
    ),
  }));

  const builtInCards = builtIn.map((tmpl) => ({
    id: tmpl.id,
    terms: terms(tmpl),
    node: (
      <TemplateCard
        key={tmpl.id}
        {...cardData(tmpl)}
        href={workflowsOn ? `/templates/${tmpl.id}` : undefined}
        footer={
          <>
            <form action={cloneTemplateAction}>
              <input type="hidden" name="id" value={tmpl.id} />
              <Button type="submit" size="sm" variant="ghost">
                {t("clone")}
              </Button>
            </form>
            <Link href={`/engagements/new?template=${tmpl.id}`}>
              <Button size="sm" variant="secondary">
                {t("use_in_new")}
              </Button>
            </Link>
          </>
        }
      />
    ),
  }));

  return (
    <TemplatesPageShell>
      {/* Fires the same server action the "New template" button uses, then
          redirects into the new template's editor. See auto-new-template.tsx
          for why this is a client effect rather than a server redirect. */}
      {sp.new != null && <AutoNewTemplate locale={locale} />}

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
