import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FilePlus2, Plus } from "lucide-react";
import { assertLocale } from "@/lib/locale";
import { listEngagementTemplates } from "@/lib/db/engagement-templates";
import { TemplateCard } from "@/components/templates/template-card";
import { ArchiveEngagementTemplate } from "@/components/templates/archive-engagement-template";
import {
  TemplatesPageShell,
  TemplatesPageHeader,
  CardGrid,
  EmptyState,
} from "@/components/templates/templates-chrome";

/**
 * Engagement templates — a whole job saved for reuse.
 *
 * Its own page, not a section. The founder replaced the single scrolling
 * Templates page with one page per type, reached from the sidebar flyout, the
 * way Canopy does it.
 */
export default async function EngagementTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const engagementTemplates = await listEngagementTemplates();
  const t = await getTranslations("Templates");

  return (
    <TemplatesPageShell>
      <TemplatesPageHeader
        title={t("section_engagement_templates")}
        subtitle={t("engagement_templates_subtitle")}
        action={
          <Link href="/templates/engagements/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              {t("engagement_templates_new")}
            </Button>
          </Link>
        }
      />

      {engagementTemplates.length === 0 ? (
        <EmptyState>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FilePlus2 className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">
            {t("engagement_templates_empty")}
          </p>
          {/* Says exactly where the button is, because there is still no way to
              create one FROM this page — you save an engagement you are already
              building. A "create" button here would have to open the whole
              engagement builder, which is its own piece of work. */}
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            {t("engagement_templates_empty_hint")}
          </p>
          <Link href="/templates/engagements/new">
            <Button className="h-[42px] gap-2 rounded-[11px] px-5 text-[14.5px] font-semibold shadow-[0_4px_14px_oklch(0.55_0.18_258_/_0.28)]">{t("engagement_templates_new")}</Button>
          </Link>
        </EmptyState>
      ) : (
        <CardGrid>
          {engagementTemplates.map((tmpl) => (
            <TemplateCard
              key={tmpl.id}
              name={tmpl.name}
              // The engagement's own type drives the glyph, the same way it does
              // for a document request. "custom" is the honest fallback for a
              // template saved before a type was picked.
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
                  <ArchiveEngagementTemplate id={tmpl.id} name={tmpl.name} />
                  <Link href={`/engagements/new?engagement_template=${tmpl.id}`}>
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
    </TemplatesPageShell>
  );
}
