import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTemplate } from "@/lib/db/templates";
import { listAutomations } from "@/lib/db/automations";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { TemplateEditor } from "@/components/templates/template-editor";
import {
  TemplateDetailShell,
  ReadOnlyItems,
} from "@/components/templates/template-detail-shell";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { cloneTemplateAndOpenAction } from "@/app/actions/templates";
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
  // "Clone to customize" lives in the Automations namespace, which is where the
  // other branch reads it from too.
  const tAuto = await getTranslations("Automations");

  const displayName = cleanLabel(localizedTemplateName(tmpl, locale));

  if (!workflowsOn) {
    // ── A BUILT-IN IS READABLE, NOT A DEAD LINK ─────────────────────────
    //
    // The founder: "when you click on document request templates, when you try
    // and open them, it completely... it says page not found."
    //
    // Reproduced: every BUILT-IN row 404'd. The list gives every row an href,
    // and this branch answered notFound() for anything the firm does not own —
    // so on a firm with workflows off, all seven built-ins were dead links.
    //
    // "Pre-1560 behaviour, byte for byte" was the reason, and it was the wrong
    // reason: the rule preserved was about EDITING somebody else's template,
    // not about being allowed to look at one. The workflows-on branch already
    // shows built-ins read-only with Clone to customize. This does the same, so
    // the two branches differ in what they offer rather than in whether the
    // page exists.
    if (tmpl.firm_id == null) {
      return (
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 pt-7 pb-18 lg:px-11">
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {displayName}
            </h1>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {t("builtin_chip")}
            </span>
            {/* The one-step door out of read-only, the same as the other
                branch: a built-in cannot be edited, so the only useful action
                is to take a copy you CAN edit. */}
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

    return (
      // px/pt/pb match TemplatesPageShell exactly. This page cannot USE that
      // shell (it is a detail page, not a list) but it must sit at the same
      // distance from the edges — the founder: the builder opened "glitched
      // off the top of the screen".
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 pt-7 pb-18 lg:px-11">
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
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-6 pt-7 pb-18 lg:px-11">
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
