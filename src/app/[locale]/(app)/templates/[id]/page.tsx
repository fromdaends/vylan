import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTemplate } from "@/lib/db/templates";
import { listAutomations } from "@/lib/db/automations";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { ReadOnlyItems } from "@/components/templates/template-read-only";
import { RequestTemplateBuilder } from "@/components/templates/request-template-builder";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { cloneTemplateAndOpenAction } from "@/app/actions/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { cleanLabel } from "@/lib/text/clean-label";
import { assertLocale } from "@/lib/locale";

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
  // "Clone to customize" lives in the Automations namespace, which is where the
  // other branch reads it from too.
  const tAuto = await getTranslations("Automations");

  const displayName = cleanLabel(localizedTemplateName(tmpl, locale));

  // ── A BUILT-IN IS READABLE, NOT EDITABLE ────────────────────────────────
  //
  // Nobody edits a built-in, in either world, so it renders its document list
  // read-only with the one-step door out. This used to 404 when workflows were
  // off — the founder: "when you try and open them, it says page not found."
  if (tmpl.firm_id == null) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 pt-7 pb-18 lg:px-11">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            {t("builtin_chip")}
          </span>
          <form action={cloneTemplateAndOpenAction} className="ml-auto">
            <input type="hidden" name="id" value={tmpl.id} />
            <input type="hidden" name="__app_locale" value={locale} />
            <Button type="submit" size="sm" variant="outline">
              <Copy className="mr-1.5 size-3.5" aria-hidden />
              {tAuto("clone_to_customize")}
            </Button>
          </form>
        </header>
        <ReadOnlyItems template={tmpl} locale={locale} />
      </div>
    );
  }

  // ── ONE BUILDER, THE SAME AS EVERY OTHER TEMPLATE TYPE ──────────────────
  //
  // There used to be two layouts here, chosen by `workflows_enabled`: a plain
  // stacked editor and a boxed-sidebar one. The flag defaults false, so the
  // sidebar version was unreachable code that still had to be kept in step with
  // the reachable one — and neither looked like the engagement, task or service
  // builders. The founder: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES
  // SHOULD ALL BE THE SAME."
  //
  // Now: one builder on the shared chrome, and the workflow sections appear as
  // EXTRA TABS when the flag is on. Nothing was deleted to get consistency.
  const [automations, members] = workflowsOn
    ? await Promise.all([listAutomations(), listActiveFirmUsers()])
    : [[], []];

  return (
    <RequestTemplateBuilder
      template={tmpl}
      displayName={displayName}
      locale={locale}
      workflowsOn={workflowsOn}
      automations={automations}
      members={members}
    />
  );
}
