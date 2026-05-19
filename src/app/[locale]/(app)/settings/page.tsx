import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ChevronRight, CreditCard, Download, ShieldCheck, Trash2 } from "lucide-react";
import { Link, getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { assertLocale } from "@/lib/locale";
import { BILLING_ENABLED } from "@/lib/billing-mode";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

// /settings: personal preferences (theme + UI language) + the firm
// timezone (used when scheduling reminders + rendering times in
// client comms) + firm-level behaviour toggles (e.g. auto-reject
// unreadable docs) + entry point to /billing. Firm identity (name,
// brand color, logo, default client locale) lives on /firm.
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }
  const [user, firm] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  if (!user || !firm) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const t = await getTranslations("Settings");

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      <SettingsForm
        currentLocale={user.locale}
        currentTimezone={firm.timezone}
        autoRejectUnusableDocs={firm.auto_reject_unusable_docs}
      />

      {/* Billing link card. Hidden while BILLING_ENABLED is false —
          we're acquiring first clients via direct chat, no fixed
          plan price yet. Flip the flag to bring this back. */}
      {BILLING_ENABLED && (
        <section>
          <h2 className="text-sm font-semibold">{t("section_billing")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("section_billing_hint")}
          </p>
          <Link
            href="/billing"
            className={
              "mt-4 group flex items-center justify-between gap-4 " +
              "rounded-lg border border-border bg-card px-4 py-3 max-w-xl " +
              "transition-colors hover:border-foreground/20 hover:bg-secondary/30"
            }
          >
            <span className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <CreditCard className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">
                {t("billing_link_label")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
      )}

      {/* Security audit log — owner-only firm-wide activity browser
          for compliance / "show the client what happened to their
          file" use cases. Owner role gating matches the page itself
          (which 404s for staff). */}
      {user.role === "owner" && (
        <section>
          <h2 className="text-sm font-semibold">{t("section_audit_title")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("section_audit_hint")}
          </p>
          <Link
            href="/settings/audit"
            className={
              "mt-4 group flex items-center justify-between gap-4 " +
              "rounded-lg border border-border bg-card px-4 py-3 max-w-xl " +
              "transition-colors hover:border-foreground/20 hover:bg-secondary/30"
            }
          >
            <span className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">
                {t("audit_link_label")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
      )}

      {/* Data & Privacy — owner-only firm data export + delete request.
          Owner role gating matches the API route. Staff members never
          see this section. */}
      {user.role === "owner" && (
        <section>
          <h2 className="text-sm font-semibold">{t("section_data_title")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("section_data_hint")}
          </p>
          <div className="mt-4 space-y-3 max-w-xl">
            <a
              href="/api/firm/export.zip"
              download
              className={
                "group flex items-center justify-between gap-4 " +
                "rounded-lg border border-border bg-card px-4 py-3 " +
                "transition-colors hover:border-foreground/20 hover:bg-secondary/30"
              }
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                  <Download className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {t("data_export_label")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("data_export_hint")}
                  </span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={`mailto:support@relai.app?subject=${encodeURIComponent(`Delete firm: ${firm.name}`)}`}
              className={
                "group flex items-center justify-between gap-4 " +
                "rounded-lg border border-border/60 bg-card/50 px-4 py-3 " +
                "transition-colors hover:border-destructive/30"
              }
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {t("data_delete_label")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("data_delete_hint")}
                  </span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
