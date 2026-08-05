import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { AutoNewTemplate } from "@/components/templates/auto-new-template";

/**
 * Create a document request template.
 *
 * ── WHY THIS ROUTE EXISTS ─────────────────────────────────────────────────
 *
 * The founder: "when clicking the plus button to create a document request
 * template, it goes first to the document template screen, and then it opens up
 * the builder, like, two seconds afterwards."
 *
 * Exactly right. Creating one used to mean landing on `/templates/requests?new=1`
 * — the whole Client requests LIST rendered, and only once it had hydrated did a
 * client effect fire the action and throw you somewhere else. You watched the
 * wrong page for two seconds.
 *
 * Now it is its own route, like /templates/tasks/new and /templates/services/new,
 * and it renders nothing but a line saying what is happening. Same act, same
 * shape as every other builder's entry point.
 *
 * ── WHY IT IS STILL A CLIENT EFFECT ───────────────────────────────────────
 *
 * Next PREFETCHES links. A server component that created the template while
 * rendering would mint a blank one every time somebody merely HOVERED the row
 * in the Create panel. An effect never runs during a prefetch, so this only
 * fires on a real visit. (createBlankTemplateAction also reuses an untouched
 * blank rather than piling up duplicates — belt and braces.)
 */
export default async function NewRequestTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Templates");

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <p className="text-sm text-muted-foreground">
        {t("creating_request_template")}
      </p>
      <AutoNewTemplate locale={locale} />
    </div>
  );
}
