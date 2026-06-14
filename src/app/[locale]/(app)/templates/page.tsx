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

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const templates = await listTemplates();
  // Hide the empty "blank" built-in — it's only the clone source for
  // "New template", never a template a firm should pick.
  const builtIn = templates.filter(
    (tmpl) => tmpl.firm_id == null && tmpl.id !== BLANK_TEMPLATE_ID,
  );
  const firm = templates.filter((tmpl) => tmpl.firm_id != null);

  const t = await getTranslations("Templates");

  // Localized "peek inside" + required count, computed once per template.
  const cardData = (tmpl: Template) => {
    const preview = tmpl.items
      .slice(0, 3)
      .map((it) => (locale === "fr" ? it.label_fr : it.label_en));
    const requiredCount = tmpl.items.filter((it) => it.required).length;
    return {
      name: localizedTemplateName(tmpl, locale),
      type: tmpl.type,
      itemCount: tmpl.items.length,
      requiredCount,
      preview,
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

      <Section title={t("section_builtin")} count={builtIn.length}>
        <CardGrid>
          {builtIn.map((tmpl) => (
            <TemplateCard
              key={tmpl.id}
              {...cardData(tmpl)}
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
  title,
  count,
  children,
  action,
}: {
  title: string;
  count: number;
  children: ReactNode;
  // Optional right-aligned action (e.g. "+ New template" on the firm
  // section). Replaces the small numeric count when present.
  action?: ReactNode;
}) {
  return (
    <section className="space-y-4">
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
