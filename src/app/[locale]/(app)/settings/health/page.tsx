import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { getCurrentFirm } from "@/lib/db/firms";
import { gatherHealthFacts } from "@/lib/health/probe";
import { assessHealth, overallLevel, type Level } from "@/lib/health/verdict";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Stethoscope, CircleCheck, TriangleAlert, CircleX } from "lucide-react";

// Always fresh: a cached health check is a lie the moment anything changes, and
// this page exists precisely to be trusted at the moment it is opened.
export const dynamic = "force-dynamic";

const STYLE: Record<
  Level,
  { icon: typeof CircleCheck; tone: string; ring: string }
> = {
  ok: { icon: CircleCheck, tone: "text-success", ring: "border-success/30" },
  warn: { icon: TriangleAlert, tone: "text-warning", ring: "border-warning/40" },
  fail: { icon: CircleX, tone: "text-destructive", ring: "border-destructive/40" },
};

export default async function SystemCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Owner-only, and a 404 rather than a 403 so the page's existence isn't
  // leaked to staff — the same gating the audit log uses. The probe runs with
  // the service role, so this check is the only thing standing in front of it.
  const user = await getCurrentUser();
  if (!can(user, "firm.settings")) notFound();
  const firm = await getCurrentFirm();
  if (!firm) notFound();

  const t = await getTranslations("Health");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  const findings = assessHealth(await gatherHealthFacts(firm.id));
  const overall = overallLevel(findings);
  const problems = findings.filter((f) => f.level !== "ok");
  const passing = findings.filter((f) => f.level === "ok");

  const Headline = STYLE[overall].icon;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: t("title") },
        ]}
      />

      <header className="animate-in-up">
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Stethoscope className="h-6 w-6 text-primary" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          {t("subtitle")}
        </p>
      </header>

      {/* The answer, before any detail. */}
      <div
        className={`rounded-xl border ${STYLE[overall].ring} bg-card px-5 py-4 flex items-start gap-3`}
      >
        <Headline
          className={`h-5 w-5 shrink-0 mt-0.5 ${STYLE[overall].tone}`}
          aria-hidden="true"
        />
        <div>
          <p className="font-medium">
            {overall === "ok"
              ? t("headline_ok")
              : overall === "warn"
                ? t("headline_warn", { count: problems.length })
                : t("headline_fail", { count: problems.length })}
          </p>
          {overall === "ok" && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("headline_ok_detail")}
            </p>
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("needs_attention")}
          </h2>
          {problems.map((f) => {
            const Icon = STYLE[f.level].icon;
            return (
              <div
                key={f.id}
                className={`rounded-xl border ${STYLE[f.level].ring} bg-card px-5 py-4`}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={`h-4 w-4 shrink-0 mt-0.5 ${STYLE[f.level].tone}`}
                    aria-hidden="true"
                  />
                  <div className="space-y-2">
                    <p className="text-sm">{f.summary}</p>
                    {f.action && (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {t("what_to_do")}
                        </span>{" "}
                        {f.action}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {passing.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("working")}
          </h2>
          <ul className="rounded-xl border border-border/60 bg-card divide-y divide-border/60">
            {passing.map((f) => (
              <li key={f.id} className="flex items-start gap-3 px-5 py-3">
                <CircleCheck
                  className="h-4 w-4 shrink-0 mt-0.5 text-success"
                  aria-hidden="true"
                />
                <span className="text-sm text-muted-foreground">{f.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
