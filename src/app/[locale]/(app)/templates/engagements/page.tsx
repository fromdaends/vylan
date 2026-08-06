import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FilePlus2, Plus } from "lucide-react";
import { assertLocale } from "@/lib/locale";
import { listEngagementTemplates } from "@/lib/db/engagement-templates";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { lastEditedLine } from "@/lib/templates/last-edited";
import { EngagementTemplateRow } from "@/components/templates/engagement-template-row";
import { SearchableTemplates } from "@/components/templates/searchable-templates";
import {
  TemplatesPageShell,
  EmptyState,
} from "@/components/templates/templates-chrome";

/**
 * Engagement templates — a whole job saved for reuse.
 *
 * Renders through SearchableTemplates like every other Templates page, so the
 * header, the search box and the rows are the same object everywhere. The
 * founder: "what the UI looks like when you click on an engagement template and
 * a task template is not the same. So it should be."
 */
export default async function EngagementTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `?saved=<id>` is set by the wizard on its way out — see the flash in
   *  template-row.tsx. Read on the SERVER so the row arrives already marked
   *  rather than lighting up a frame after the page settles. */
  searchParams: Promise<{ saved?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { saved: savedId } = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [engagementTemplates, viewer, members] = await Promise.all([
    listEngagementTemplates(),
    getCurrentUser(),
    listFirmUsers(),
  ]);
  const t = await getTranslations("Templates");
  const nameById = new Map(members.map((m) => [m.id, userDisplayLabel(m)]));

  // The one line under each name. Built here rather than in the row so the
  // server does the counting and the row stays about presentation.
  const metaFor = (tmpl: (typeof engagementTemplates)[number]) => {
    const parts: string[] = [];
    if (tmpl.payload.items.length > 0) {
      parts.push(t("services_count", { count: tmpl.payload.items.length }));
    }
    if (tmpl.payload.checklist.length > 0) {
      parts.push(t("documents_count", { count: tmpl.payload.checklist.length }));
    }
    if (tmpl.payload.title.trim()) parts.push(tmpl.payload.title.trim());
    // Canopy's line, last: what it is, then when it was touched.
    const edited = lastEditedLine(
      {
        updatedAt: tmpl.updatedAt,
        updatedByUserId: tmpl.updatedByUserId,
        viewerUserId: viewer?.id ?? null,
        nameById,
      },
      t,
      locale,
    );
    if (edited) parts.push(edited);
    return parts.join(" · ");
  };

  return (
    <TemplatesPageShell>
      <SearchableTemplates
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
        tabs={["team", "private", "draft"]}
        sections={[
          {
            key: "all",
            primary: true,
            title: t("section_engagement_templates"),
            cards: engagementTemplates.map((tmpl) => ({
              id: tmpl.id,
              // A draft belongs ONLY under Drafts, whatever its access level —
              // a half-written template appearing in Team is exactly what that
              // tab exists to prevent.
              group: tmpl.payload.isDraft
                ? ("draft" as const)
                : tmpl.access === "private"
                  ? ("private" as const)
                  : ("team" as const),
              // Findable by its own name AND by what it contains — searching
              // "T4" should find the template that asks for one.
              terms: [
                tmpl.name,
                tmpl.payload.title,
                ...tmpl.payload.items.map((i) => i.name),
                ...tmpl.payload.checklist.map((c) =>
                  locale === "fr" ? c.label_fr : c.label_en,
                ),
              ].join(" "),
              node: (
                <EngagementTemplateRow
                  key={tmpl.id}
                  id={tmpl.id}
                  name={tmpl.name}
                  type={tmpl.payload.type ?? "custom"}
                  meta={metaFor(tmpl)}
                  fresh={tmpl.id === savedId}
                />
              ),
            })),
            empty: (
              <EmptyState
                icon={FilePlus2}
                title={t("engagement_templates_empty")}
                hint={t("engagement_templates_empty_hint")}
                action={
                  <Link href="/templates/engagements/new">
                    <Button size="sm">
                      <Plus className="h-3.5 w-3.5" />
                      {t("engagement_templates_new")}
                    </Button>
                  </Link>
                }
              />
            ),
          },
        ]}
      />
    </TemplatesPageShell>
  );
}
