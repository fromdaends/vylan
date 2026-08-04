import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  listTemplates,
  BLANK_TEMPLATE_ID,
  type Template,
} from "@/lib/db/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { TemplateCard } from "@/components/templates/template-card";
import {
  cloneTemplateAction,
  createBlankTemplateAction,
  deleteTemplateAction,
} from "@/app/actions/templates";
import { assertLocale } from "@/lib/locale";
import { Plus, FilePlus2 } from "lucide-react";
import { listFirmServices } from "@/lib/db/firm-services";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import {
  buildWorkflowSummaryLine,
} from "@/lib/workflow/summary";
import { parseWorkflowDefinition } from "@/lib/workflow/definition";
import { ServiceCatalogue } from "@/components/templates/service-catalogue";
import { AutoNewTemplate } from "@/components/templates/auto-new-template";
import { listEngagementTemplates } from "@/lib/db/engagement-templates";
import { ArchiveEngagementTemplate } from "@/components/templates/archive-engagement-template";

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  // `new` comes from the + Create panel and means "start making one".
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const sp = await searchParams;
  const [templates, services, user, currentFirm, engagementTemplates] =
    await Promise.all([
      listTemplates(),
      listFirmServices(),
      getCurrentUser(),
      // The workflows switch (chunk 2b, #1337).
      getCurrentFirm(),
      // Whole saved engagements (migration 1500). Until now these were readable
      // from exactly ONE place — the new-engagement page's start chooser — so a
      // template you saved could be used but never seen, renamed or removed.
      // archiveEngagementTemplateAction already revalidated this route for a
      // section that did not exist yet.
      listEngagementTemplates(),
    ]);
  // Part A switch (1510): with it on, template cards open their detail page
  // (built-ins read-only) and carry a one-line automation summary. Off = the
  // page exactly as it was.
  const workflowsOn =
    (currentFirm as { workflows_enabled?: boolean } | null)
      ?.workflows_enabled === true;
  // Editing what the firm SELLS is a firm-settings decision, not something
  // anyone with an engagement can do. The server action enforces this too —
  // this only decides whether the controls are drawn.
  const canManageServices = user != null && can(user, "firm.settings");
  // Hide the empty "blank" built-in — it's only the clone source for
  // "New template", never a template a firm should pick.
  const builtIn = templates.filter(
    (tmpl) => tmpl.firm_id == null && tmpl.id !== BLANK_TEMPLATE_ID,
  );
  const firm = templates.filter((tmpl) => tmpl.firm_id != null);

  const t = await getTranslations("Templates");
  const tEng = await getTranslations("Engagements");
  const tAuto = await getTranslations("Automations");

  // Localized "peek inside" + required count, computed once per template.
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

  return (
    <div className="mx-auto max-w-5xl space-y-10 min-[1800px]:max-w-[90rem]">
      <header className="animate-in-up">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </header>

      {/* Fires the same server action the "New template" button uses, then
          redirects into the new template's editor. See auto-new-template.tsx
          for why this is a client effect rather than a server redirect. */}
      {sp.new === "document" && <AutoNewTemplate locale={locale} />}

      {/* WHOLE ENGAGEMENTS FIRST.
          Services used to lead this page, and as a rule — building blocks
          before the things built from them — that was defensible. But an
          engagement template CONTAINS services and documents, so it is the
          thing a firm reaches for most and the thing Canopy's own Templates
          page leads with. The blocks stay directly beneath it. */}
      <Section
        id="engagement-templates"
        title={t("section_engagement_templates")}
        count={engagementTemplates.length}
      >
        <p className="-mt-1 mb-4 max-w-xl text-sm text-muted-foreground">
          {t("engagement_templates_subtitle")}
        </p>
        {engagementTemplates.length === 0 ? (
          <EmptyState>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <FilePlus2 className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {t("engagement_templates_empty")}
            </p>
            {/* Says exactly where the button is, because there is no way to
                create one FROM this page yet — you save an engagement you are
                already building. A "create" button here would have to open the
                whole engagement builder, which is its own piece of work. */}
            <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
              {t("engagement_templates_empty_hint")}
            </p>
          </EmptyState>
        ) : (
          <CardGrid>
            {engagementTemplates.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                name={tmpl.name}
                // The engagement's own type drives the glyph, the same way it
                // does for a document request. "custom" is the honest fallback
                // for a template saved before a type was picked.
                type={tmpl.payload.type ?? "custom"}
                itemCount={tmpl.payload.checklist.length}
                requiredCount={
                  tmpl.payload.checklist.filter((it) => it.required).length
                }
                serviceCount={tmpl.payload.items.length}
                preview={tmpl.payload.checklist
                  .slice(0, 3)
                  .map((it) =>
                    locale === "fr"
                      ? it.label_fr || it.label_en
                      : it.label_en || it.label_fr,
                  )}
                badge={
                  tmpl.access === "private" ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("access_private")}
                    </span>
                  ) : null
                }
                footer={
                  <>
                    <ArchiveEngagementTemplate
                      id={tmpl.id}
                      name={tmpl.name}
                    />
                    <Link
                      href={`/engagements/new?engagement_template=${tmpl.id}`}
                    >
                      <Button size="sm" variant="secondary">
                        {t("use_in_new")}
                      </Button>
                    </Link>
                  </>
                }
              />
            ))}
          </CardGrid>
        )}
      </Section>

      {/* SERVICES — what you SELL comes before what you ask a client to
          send you. The founder put the catalogue here rather than in Settings
          because it is the same kind of thing as the lists below: something you
          set up once and reuse on every engagement. */}
      <Section
        id="services"
        title={tEng("services_title")}
        count={services.length}
      >
        <p className="-mt-1 mb-4 max-w-xl text-sm text-muted-foreground">
          {tEng("services_subtitle")}
        </p>
        <ServiceCatalogue
          services={services}
          locale={locale}
          canManage={canManageServices}
          openOnMount={sp.new === "service"}
        />
      </Section>

      <Section
        id="document-requests"
        title={t("section_builtin")}
        count={builtIn.length}
      >
        <CardGrid>
          {builtIn.map((tmpl) => (
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
          ))}
        </CardGrid>
      </Section>

      <Section
        title={t("section_firm")}
        count={firm.length}
        action={
          <form action={createBlankTemplateAction}>
            <input type="hidden" name="__app_locale" value={locale} />
            <Button type="submit" size="sm">
              <Plus className="h-3.5 w-3.5" />
              {t("templates_new")}
            </Button>
          </form>
        }
      >
        {firm.length === 0 ? (
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
        ) : (
          <CardGrid>
            {firm.map((tmpl) => (
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
            ))}
          </CardGrid>
        )}
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  count,
  children,
  action,
}: {
  /** Anchor target, so the Create panel can link straight to a section. */
  id?: string;
  title: string;
  count: number;
  children: ReactNode;
  // Optional right-aligned action (e.g. "+ New template" on the firm
  // section). Replaces the small numeric count when present.
  action?: ReactNode;
}) {
  return (
    <section id={id} className="space-y-4">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {title}
          </h2>
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {count}
          </span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
      {children}
    </div>
  );
}
