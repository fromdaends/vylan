"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { useRouter, Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Moon,
  Sun,
  Monitor,
  Check,
  Palette,
  SlidersHorizontal,
  FileText,
  ShieldCheck,
  Wallet,
  Plug,
  Download,
  Trash2,
  ChevronRight,
  UserCog,
  Users,
  Bot,
  Zap,
} from "lucide-react";
import { updateLocaleAction } from "@/app/actions/profile";
import { cn } from "@/lib/cn";
import { isOwnerOnlySettingsSection } from "@/lib/settings/owner-sections";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FirmSettingsSections,
  type FirmInfo,
} from "@/components/settings/firm-settings-sections";
import { AccountSignInSections } from "@/components/settings/account-security-sections";
import {
  PaymentsConnectSection,
  type ConnectStatus,
} from "@/components/settings/payments-section";
import {
  IntegrationsSection,
  type QuickbooksStatus,
} from "@/components/settings/integrations-section";
import { PaymentsServicePrices } from "@/components/settings/payments-service-prices";
import { PaymentsInvoiceDefaults } from "@/components/settings/payments-invoice-defaults";
import { ReminderAutomationDefaults } from "@/components/settings/reminder-automation-defaults";
import { PaymentsList } from "@/components/payments/payments-list";
import type { PaymentsListRow } from "@/lib/db/payment-requests";
import type { ReminderSettings } from "@/lib/reminder-settings";
import { MfaSection } from "@/components/profile/mfa-section";
// Type-only import (erased at build) — safe in this client component even though
// usage.ts is server code. Keeps the AI-usage prop shape in sync with the source.
import type { AiUsage } from "@/lib/ai/usage";

type ThemeChoice = "light" | "dark" | "system";
type SectionId =
  | "account"
  | "security"
  | "general"
  | "payments"
  | "automation"
  | "integrations"
  | "documents"
  | "assistant";
type Translate = (k: string, values?: Record<string, string | number>) => string;

// Same Canadian zones that used to live in /firm. Kept in sync with the
// server-side allow-list in /api/firm/timezone — if you add a zone here,
// add it there too. The label is a Common.* i18n key (resolved at render) so
// the zone descriptors translate (Eastern → Est, etc.).
const CA_TIMEZONES: ReadonlyArray<readonly [string, string]> = [
  ["America/Toronto", "tz_eastern"],
  ["America/Halifax", "tz_atlantic"],
  ["America/St_Johns", "tz_newfoundland"],
  ["America/Winnipeg", "tz_central"],
  ["America/Edmonton", "tz_mountain"],
  ["America/Vancouver", "tz_pacific"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Shell: a left sub-nav of categories + the selected category on the right.
// Collapses to a horizontal scrolling tab row on narrow widths. Defaults to
// Account. Server data arrives as props; everything is bilingual via the
// existing Settings namespace.
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_IDS: SectionId[] = [
  "account",
  "security",
  "general",
  "payments",
  "automation",
  "integrations",
  "documents",
  "assistant",
];

export function SettingsShell({
  currentLocale,
  currentTimezone,
  autoRejectUnusableDocs,
  autoRejectDuplicates,
  autoRequestMissingPages,
  includeQuebecForms,
  chatConfirmActions,
  invoiceDefaultMode,
  invoiceDefaultDelayDays,
  reminderDefaultSettings,
  aiUsage,
  isOwner,
  billingSlot,
  connect,
  quickbooks,
  servicePrices,
  paymentsList,
  currentUserId,
  firmName,
  firm,
  firmLogoUrl,
  email,
  mfaEnabled,
  initialSection,
}: {
  currentLocale: "fr" | "en";
  currentTimezone: string;
  autoRejectUnusableDocs: boolean;
  autoRejectDuplicates: boolean;
  autoRequestMissingPages: boolean;
  includeQuebecForms: boolean;
  // Engagement-assistant "send confirmation cards" toggle (owner-only).
  chatConfirmActions: boolean;
  // Firm-wide default invoice automation (owner-only, migration 0590).
  invoiceDefaultMode: "off" | "on_completion" | "delayed";
  invoiceDefaultDelayDays: number | null;
  reminderDefaultSettings: ReminderSettings | null;
  aiUsage: AiUsage;
  isOwner: boolean;
  // Subscription card, rendered on the server (it's an async component) and
  // passed in as a slot so the client shell can show it under the Payments tab.
  // Null for non-owners.
  billingSlot: React.ReactNode;
  // Stripe Connect status for the "Get paid by clients" block at the top of the
  // Payments section. Null for non-owners.
  connect: ConnectStatus | null;
  // QuickBooks (Intuit) connection status for the Integrations section. Null for
  // non-owners.
  quickbooks: QuickbooksStatus | null;
  // Per-service default prices (cents) for the Payments section editor. Null for
  // non-owners.
  servicePrices: Record<string, number> | null;
  // Firm-wide recent payments for the Payments section list. Null for non-owners.
  paymentsList: PaymentsListRow[] | null;
  // The viewing owner's id, so the payments list can hide "sent by you" and only
  // tag a teammate's invoices.
  currentUserId: string;
  firmName: string;
  firm: FirmInfo;
  firmLogoUrl: string | null;
  email: string;
  mfaEnabled: boolean;
  // Deep-link target (?tab=account from the avatar menu + the old /firm
  // redirect). Falls back to Account.
  initialSection?: string;
}) {
  const t = useTranslations("Settings");
  // The subscription summary used to live under its own "billing" tab; it now
  // lives inside the new "Payments" section. Keep old ?tab=billing bookmarks /
  // links working by aliasing them to the Payments section.
  const aliased =
    initialSection === "billing"
      ? "payments"
      : initialSection === "appearance"
        ? "general"
        : initialSection;
  const requested: SectionId = SECTION_IDS.includes(aliased as SectionId)
    ? (aliased as SectionId)
    : "account";
  // Staff deep-linking ?tab=payments / ?tab=documents would land on an empty
  // owner-only tab — fall back to Account.
  const [section, setSection] = useState<SectionId>(
    !isOwner && isOwnerOnlySettingsSection(requested) ? "account" : requested,
  );

  const allNav: { id: SectionId; label: string; icon: typeof Palette }[] = [
    { id: "account", label: t("nav_account"), icon: UserCog },
    { id: "security", label: t("nav_security"), icon: ShieldCheck },
    { id: "general", label: t("nav_general"), icon: SlidersHorizontal },
    { id: "payments", label: t("nav_payments"), icon: Wallet },
    { id: "automation", label: t("nav_automation"), icon: Zap },
    { id: "integrations", label: t("nav_integrations"), icon: Plug },
    { id: "documents", label: t("nav_documents"), icon: FileText },
    { id: "assistant", label: t("nav_assistant"), icon: Bot },
  ];
  // Owner-only tabs (Billing, Documents) are hidden from staff.
  const nav = allNav.filter((n) => isOwner || !isOwnerOnlySettingsSection(n.id));

  return (
    <div className="flex flex-col gap-8 md:flex-row md:gap-10">
      <nav
        aria-label={t("title")}
        className="flex shrink-0 gap-1 overflow-x-auto -mx-1 px-1 md:mx-0 md:w-48 md:flex-col md:overflow-visible md:px-0"
      >
        {nav.map((n) => {
          const active = section === n.id;
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {n.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1">
        {section === "account" && (
          <AccountSection
            firm={firm}
            firmLogoUrl={firmLogoUrl}
            email={email}
            isOwner={isOwner}
            t={t}
          />
        )}
        {section === "security" && (
          <div className="space-y-12">
            <MfaSection initialEnabled={mfaEnabled} />
            {isOwner && <DataPrivacySection firmName={firmName} t={t} />}
          </div>
        )}
        {section === "general" && (
          <GeneralSection
            currentLocale={currentLocale}
            currentTimezone={currentTimezone}
            isOwner={isOwner}
            t={t}
          />
        )}
        {section === "payments" && isOwner && (
          // Payments home: client-payment collection (Stripe Connect) on top,
          // the firm's own Vylan subscription below.
          <div className="space-y-12">
            {connect && <PaymentsConnectSection connect={connect} />}
            {servicePrices && (
              <PaymentsServicePrices prices={servicePrices} />
            )}
            {paymentsList && paymentsList.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold">
                  {t("payments_history_title")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("payments_history_hint")}
                </p>
                <div className="mt-4 max-w-xl">
                  <PaymentsList
                    rows={paymentsList}
                    currentUserId={currentUserId}
                  />
                </div>
              </section>
            )}
            {billingSlot}
          </div>
        )}
        {section === "automation" && isOwner && (
          // Everything that runs WITHOUT the accountant doing it by hand
          // lives here (founder) — for now the invoice automation default
          // (moved out of Payments); more automations join over time.
          <div className="space-y-12">
            <section>
              <h2 className="text-sm font-semibold">
                {t("automation_title")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("automation_hint")}
              </p>
            </section>
            <ReminderAutomationDefaults
              initialSettings={reminderDefaultSettings}
            />
            {connect?.chargesEnabled ? (
              <PaymentsInvoiceDefaults
                initialMode={invoiceDefaultMode}
                initialDelayDays={invoiceDefaultDelayDays}
              />
            ) : (
              <p className="max-w-xl text-sm text-muted-foreground">
                {t("automation_needs_connect")}
              </p>
            )}
          </div>
        )}
        {section === "integrations" && quickbooks && (
          <IntegrationsSection quickbooks={quickbooks} isOwner={isOwner} />
        )}
        {section === "documents" && isOwner && (
          <DocumentsSection
            autoRejectUnusableDocs={autoRejectUnusableDocs}
            autoRejectDuplicates={autoRejectDuplicates}
            autoRequestMissingPages={autoRequestMissingPages}
            includeQuebecForms={includeQuebecForms}
            aiUsage={aiUsage}
            locale={currentLocale}
            t={t}
          />
        )}
        {section === "assistant" && isOwner && (
          <AssistantSection chatConfirmActions={chatConfirmActions} t={t} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account — your sign-in (Email, Password) up top, then your firm settings
// (logo, name, brand color, client-email language). Two-factor lives under
// Security & privacy; the subscription summary lives in Payments.
// ─────────────────────────────────────────────────────────────────────────────

function AccountSection({
  firm,
  firmLogoUrl,
  email,
  isOwner,
  t,
}: {
  firm: FirmInfo;
  firmLogoUrl: string | null;
  email: string;
  isOwner: boolean;
  t: Translate;
}) {
  return (
    <div className="space-y-12">
      <AccountSignInSections email={email} />

      {isOwner && (
        <Link
          href="/settings/team"
          className="group flex max-w-xl items-center justify-between gap-4 rounded-lg border border-border/50 px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
        >
          <span className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <Users className="h-4 w-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t("section_team_label")}</span>
              <span className="text-xs text-muted-foreground">
                {t("section_team_hint")}
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      {isOwner ? (
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            {t("section_firm_settings")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("section_firm_settings_hint")}
          </p>
          <div className="mt-5">
            <FirmSettingsSections firm={firm} firmLogoUrl={firmLogoUrl} />
          </div>
        </div>
      ) : (
        // Staff see their own sign-in settings; firm branding/name is owner-only.
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          {t("owner_only_note")}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Appearance — Mode (Light/Dark/System), each a selectable card with a small
// static preview swatch. The System card previews the OS's prefers-color-scheme
// (live), independent of the mode currently selected.
// ─────────────────────────────────────────────────────────────────────────────

function AppearanceSection({ t }: { t: Translate }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setSystemDark(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const activeMode = (mounted ? theme : "system") as ThemeChoice;
  // The System card previews the OS's prefers-color-scheme — i.e. what System
  // would actually resolve to — independent of the mode currently selected,
  // and updates live if the OS preference changes. (resolvedTheme would echo a
  // manually-chosen Light/Dark instead of the real OS setting.)
  const systemMode: "light" | "dark" = mounted && systemDark ? "dark" : "light";

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("mode_label")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("mode_hint")}</p>
      <div className="mt-4 grid max-w-lg grid-cols-3 gap-3">
        <OptionCard
          label={t("theme_light")}
          icon={<Sun className="h-3.5 w-3.5" />}
          active={activeMode === "light"}
          onClick={() => setTheme("light")}
          swatch={<ThemeSwatch mode="light" />}
        />
        <OptionCard
          label={t("theme_dark")}
          icon={<Moon className="h-3.5 w-3.5" />}
          active={activeMode === "dark"}
          onClick={() => setTheme("dark")}
          swatch={<ThemeSwatch mode="dark" />}
        />
        <OptionCard
          label={t("theme_system")}
          icon={<Monitor className="h-3.5 w-3.5" />}
          active={activeMode === "system"}
          onClick={() => setTheme("system")}
          swatch={<ThemeSwatch mode={systemMode} />}
        />
      </div>
    </section>
  );
}

// Static mode preview. Uses explicit light/dark colors (NOT theme tokens) so a
// card always shows its own mode regardless of the page's current theme — the
// Light card stays white even while the app is in dark mode. Neutral + basic,
// no accent color.
function ThemeSwatch({ mode }: { mode: "light" | "dark" }) {
  const dark = mode === "dark";
  return (
    <div
      className={
        "flex flex-col gap-1.5 rounded-md border p-2.5 " +
        (dark ? "border-white/10 bg-zinc-950" : "border-black/10 bg-white")
      }
    >
      <div
        className={
          "h-1.5 w-1/2 rounded-full " + (dark ? "bg-white/30" : "bg-black/20")
        }
      />
      <div
        className={
          "h-1.5 w-4/5 rounded-full " + (dark ? "bg-white/15" : "bg-black/10")
        }
      />
      <div
        className={
          "h-1.5 w-2/3 rounded-full " + (dark ? "bg-white/15" : "bg-black/10")
        }
      />
    </div>
  );
}

function OptionCard({
  label,
  icon,
  active,
  onClick,
  swatch,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  swatch: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
        active
          ? "border-accent ring-2 ring-accent/40"
          : "border-border hover:border-foreground/20",
      )}
    >
      {swatch}
      <span className="flex items-center gap-1.5 px-0.5 text-xs font-medium">
        {icon}
        {label}
      </span>
      {active && (
        <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-accent" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// General — UI language + firm timezone.
// ─────────────────────────────────────────────────────────────────────────────

function GeneralSection({
  currentLocale,
  currentTimezone,
  isOwner,
  t,
}: {
  currentLocale: "fr" | "en";
  currentTimezone: string;
  isOwner: boolean;
  t: Translate;
}) {
  return (
    <div className="space-y-10">
      <AppearanceSection t={t} />
      {/* UI language is a per-user preference (kept for staff); the firm
          timezone is a firm-wide setting (owner-only). */}
      <LanguageSection currentLocale={currentLocale} t={t} />
      {isOwner && (
        <TimezoneSection currentTimezone={currentTimezone} t={t} />
      )}
    </div>
  );
}

function LanguageSection({
  currentLocale,
  t,
}: {
  currentLocale: "fr" | "en";
  t: Translate;
}) {
  const router = useRouter();
  const activeLocale = useLocale();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<"fr" | "en">(currentLocale);
  const [error, setError] = useState<string | null>(null);

  function onChange(next: "fr" | "en") {
    if (next === value) return;
    setValue(next);
    setError(null);
    const fd = new FormData();
    fd.append("locale", next);
    startTransition(async () => {
      const res = await updateLocaleAction(fd);
      if (!res.ok) {
        setError(t("save_failed"));
        setValue(currentLocale);
        return;
      }
      if (next !== activeLocale) {
        router.replace("/settings", { locale: next });
      }
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_language")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("section_language_hint")}
      </p>
      <div className="mt-4 inline-flex rounded-md bg-secondary/40 p-0.5">
        <LangButton
          label="Français"
          active={value === "fr"}
          onClick={() => onChange("fr")}
          disabled={pending}
        />
        <LangButton
          label="English"
          active={value === "en"}
          onClick={() => onChange("en")}
          disabled={pending}
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function LangButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TimezoneSection({
  currentTimezone,
  t,
}: {
  currentTimezone: string;
  t: Translate;
}) {
  const tc = useTranslations("Common");
  const [value, setValue] = useState(currentTimezone);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    try {
      const res = await fetch("/api/firm/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: next }),
      });
      if (!res.ok) {
        setValue(prev);
        setError(t("save_failed"));
      }
    } catch (e) {
      console.error("[TimezoneSection] save failed:", e);
      setValue(prev);
      setError(t("save_failed"));
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_timezone")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("section_timezone_hint")}
      </p>
      <div className="mt-4">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CA_TIMEZONES.map(([tz, labelKey]) => (
              <SelectItem key={tz} value={tz}>
                {tc(labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents — firm-wide upload handling (auto-reject unreadable docs).
// Optimistic toggle via a plain POST (keeps the save independent of the RSC
// re-render); revert + inline error on failure.
// ─────────────────────────────────────────────────────────────────────────────

function DocumentsSection({
  autoRejectUnusableDocs,
  autoRejectDuplicates,
  autoRequestMissingPages,
  includeQuebecForms,
  aiUsage,
  locale,
  t,
}: {
  autoRejectUnusableDocs: boolean;
  autoRejectDuplicates: boolean;
  autoRequestMissingPages: boolean;
  includeQuebecForms: boolean;
  aiUsage: AiUsage;
  locale: "fr" | "en";
  t: Translate;
}) {
  const [enabled, setEnabled] = useState(autoRejectUnusableDocs);
  const [error, setError] = useState<string | null>(null);
  // SEPARATE toggle from the unusable-docs one above: auto-reject exact-duplicate
  // re-uploads. Optimistic save via its own POST route; revert on failure.
  const [dupEnabled, setDupEnabled] = useState(autoRejectDuplicates);
  const [dupError, setDupError] = useState<string | null>(null);
  // SEPARATE again: auto-ask the client for a confidently-missing page in a
  // multi-page document. Same optimistic-save-and-revert pattern, own POST route.
  const [missingPagesEnabled, setMissingPagesEnabled] = useState(
    autoRequestMissingPages,
  );
  const [missingPagesError, setMissingPagesError] = useState<string | null>(
    null,
  );
  // SEPARATE again (migration 0350): whether this firm uses the Quebec-only
  // RL slips at all. Same optimistic-save-and-revert pattern, own POST route.
  const [quebecEnabled, setQuebecEnabled] = useState(includeQuebecForms);
  const [quebecError, setQuebecError] = useState<string | null>(null);

  async function onDuplicatesToggle(next: boolean) {
    setDupError(null);
    setDupEnabled(next);
    try {
      const res = await fetch("/api/firm/auto-reject-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setDupError(t("save_failed"));
        setDupEnabled(!next);
      }
    } catch (e) {
      console.error("[onToggle] auto-reject-duplicates save failed:", e);
      setDupError(t("save_failed"));
      setDupEnabled(!next);
    }
  }

  async function onMissingPagesToggle(next: boolean) {
    setMissingPagesError(null);
    setMissingPagesEnabled(next);
    try {
      const res = await fetch("/api/firm/auto-request-missing-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setMissingPagesError(t("save_failed"));
        setMissingPagesEnabled(!next);
      }
    } catch (e) {
      console.error("[onToggle] auto-request-missing-pages save failed:", e);
      setMissingPagesError(t("save_failed"));
      setMissingPagesEnabled(!next);
    }
  }

  async function onQuebecToggle(next: boolean) {
    setQuebecError(null);
    setQuebecEnabled(next);
    try {
      const res = await fetch("/api/firm/include-quebec-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setQuebecError(t("save_failed"));
        setQuebecEnabled(!next);
      }
    } catch (e) {
      console.error("[onToggle] include-quebec-forms save failed:", e);
      setQuebecError(t("save_failed"));
      setQuebecEnabled(!next);
    }
  }

  const pct = Math.min(
    100,
    Math.round((aiUsage.used / Math.max(1, aiUsage.cap)) * 100),
  );
  // Trial firms have a LIFETIME cap (no monthly reset — it lifts on upgrade), so
  // we never show a reset date for them. The monthly meter resets at the first
  // of next month UTC; format in UTC so a behind-UTC viewer doesn't see it slip
  // to "the 30th". Guard against an empty/invalid resetsAt so it never renders
  // "Invalid Date".
  const resetDate =
    !aiUsage.isTrial && aiUsage.resetsAt
      ? new Date(aiUsage.resetsAt).toLocaleDateString(
          locale === "fr" ? "fr-CA" : "en-CA",
          { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
        )
      : null;

  async function onToggle(next: boolean) {
    setError(null);
    setEnabled(next);
    try {
      const res = await fetch("/api/firm/auto-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setError(t("save_failed"));
        setEnabled(!next);
      }
    } catch (e) {
      console.error("[onToggle] auto-reject save failed:", e);
      setError(t("save_failed"));
      setEnabled(!next);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_doc_handling")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("section_doc_handling_hint")}
      </p>

      {/* AI monthly-cap status — read-only. The cap auto-pauses the AI checks
          for the rest of the month to bound token spend; uploads keep working. */}
      <div className="mt-4 max-w-xl rounded-lg border border-border/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">{t("ai_usage_label")}</div>
          <span
            className={
              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium " +
              (aiUsage.paused
                ? "bg-warning/15 text-warning"
                : "bg-accent/15 text-accent")
            }
          >
            {aiUsage.paused ? t("ai_paused_badge") : t("ai_active_badge")}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {aiUsage.isTrial
            ? t("ai_usage_count_trial", {
                used: aiUsage.used,
                cap: aiUsage.cap,
              })
            : t("ai_usage_count", { used: aiUsage.used, cap: aiUsage.cap })}
          {resetDate && (
            <>
              {" · "}
              {t("ai_resets_on", { date: resetDate })}
            </>
          )}
        </p>
        <div
          className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("ai_usage_label")}
        >
          <div
            className={
              "h-full rounded-full transition-all " +
              (aiUsage.paused ? "bg-warning" : "bg-primary")
            }
            style={{ width: `${pct}%` }}
          />
        </div>
        {aiUsage.paused && (
          <p className="mt-2 text-xs text-warning">
            {aiUsage.isTrial ? t("ai_trial_limit_hint") : t("ai_paused_hint")}
          </p>
        )}
      </div>

      <div className="mt-4 flex max-w-xl items-start justify-between gap-4 rounded-lg border border-border/50 px-4 py-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{t("auto_reject_label")}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("auto_reject_help")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={t("auto_reject_label")}
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {/* Separate setting: auto-reject exact-duplicate re-uploads (vs the
          unusable-docs toggle above). */}
      <div className="mt-3 flex max-w-xl items-start justify-between gap-4 rounded-lg border border-border/50 px-4 py-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {t("auto_reject_duplicates_label")}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("auto_reject_duplicates_help")}
          </p>
        </div>
        <Switch
          checked={dupEnabled}
          onCheckedChange={onDuplicatesToggle}
          ariaLabel={t("auto_reject_duplicates_label")}
        />
      </div>
      {dupError && <p className="mt-2 text-xs text-destructive">{dupError}</p>}

      {/* Separate setting: auto-ask the client for a confidently-missing page in
          a multi-page document (set-aware analysis). */}
      <div className="mt-3 flex max-w-xl items-start justify-between gap-4 rounded-lg border border-border/50 px-4 py-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {t("auto_request_missing_pages_label")}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("auto_request_missing_pages_help")}
          </p>
        </div>
        <Switch
          checked={missingPagesEnabled}
          onCheckedChange={onMissingPagesToggle}
          ariaLabel={t("auto_request_missing_pages_label")}
        />
      </div>
      {missingPagesError && (
        <p className="mt-2 text-xs text-destructive">{missingPagesError}</p>
      )}

      {/* A distinct group from the AI document-handling toggles above: this is
          about WHICH tax forms land on a checklist, not how uploads are handled
          by the AI. Its own heading + a divider so it never reads as a fourth
          AI setting. */}
      <div className="mt-10 border-t border-border/50 pt-8">
        <h2 className="text-sm font-semibold">{t("section_tax_forms")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("section_tax_forms_hint")}
        </p>
      </div>
      <div className="mt-4 flex max-w-xl items-start justify-between gap-4 rounded-lg border border-border/50 px-4 py-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {t("include_quebec_forms_label")}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("include_quebec_forms_help")}
          </p>
        </div>
        <Switch
          checked={quebecEnabled}
          onCheckedChange={onQuebecToggle}
          ariaLabel={t("include_quebec_forms_label")}
        />
      </div>
      {quebecError && (
        <p className="mt-2 text-xs text-destructive">{quebecError}</p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Assistant (owner-only) — whether the engagement assistant must show a
// confirm card before it acts. ON (default) = every action waits for a human
// Confirm. OFF = the assistant carries out actions itself (deletions still
// confirm). Same optimistic-save-and-revert pattern as the document toggles.
// ─────────────────────────────────────────────────────────────────────────────

function AssistantSection({
  chatConfirmActions,
  t,
}: {
  chatConfirmActions: boolean;
  t: Translate;
}) {
  const [enabled, setEnabled] = useState(chatConfirmActions);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(next: boolean) {
    setError(null);
    setEnabled(next);
    try {
      const res = await fetch("/api/firm/chat-confirm-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setError(t("save_failed"));
        setEnabled(!next);
      }
    } catch (e) {
      console.error("[onToggle] chat-confirm-actions save failed:", e);
      setError(t("save_failed"));
      setEnabled(!next);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_assistant")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("section_assistant_hint")}
      </p>

      <div className="mt-4 flex max-w-xl items-start justify-between gap-4 rounded-lg border border-border/50 px-4 py-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{t("confirm_cards_label")}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("confirm_cards_help")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={t("confirm_cards_label")}
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {/* When confirmation is OFF, spell out what that means — the assistant
          now acts on its own (deletions still ask). */}
      {!enabled && (
        <div className="mt-3 max-w-xl rounded-lg border border-warning/40 bg-warning/[0.06] px-4 py-3">
          <p className="text-xs leading-relaxed text-warning">
            {t("confirm_cards_off_warning")}
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data & privacy (owner-only) — audit log, firm export, delete request.
// ─────────────────────────────────────────────────────────────────────────────

function DataPrivacySection({
  firmName,
  t,
}: {
  firmName: string;
  t: Translate;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_data_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("section_data_hint")}
      </p>
      <div className="mt-4 max-w-xl space-y-3">
        <Link
          href="/settings/audit"
          className="group flex items-center justify-between gap-4 rounded-lg border border-border/50 px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
        >
          <span className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium">
                {t("audit_link_label")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("section_audit_hint")}
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
        <a
          href="/api/firm/export.zip"
          download
          className="group flex items-center justify-between gap-4 rounded-lg border border-border/50 px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
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
      </div>

      <div className="mt-8 max-w-xl">
        <a
          href={`mailto:hello@vylan.app?subject=${encodeURIComponent(`Delete firm: ${firmName}`)}`}
          className="group flex items-center justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/[0.04] px-4 py-3 transition-colors hover:border-destructive hover:bg-destructive/10"
        >
          <span className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-destructive/15 text-destructive">
              <Trash2 className="h-4 w-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium text-destructive">
                {t("data_delete_label")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("data_delete_hint")}
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-destructive/60 transition-transform group-hover:translate-x-0.5" />
        </a>
      </div>
    </section>
  );
}
