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
  CreditCard,
  Download,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { updateLocaleAction } from "@/app/actions/profile";
import { useAccent, type Accent } from "@/components/theme/accent-provider";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ThemeChoice = "light" | "dark" | "system";
type SectionId = "appearance" | "general" | "documents" | "data";
type Translate = (k: string) => string;

// Same Canadian zones that used to live in /firm. Kept in sync with the
// server-side allow-list in /api/firm/timezone — if you add a zone here,
// add it there too.
const CA_TIMEZONES: ReadonlyArray<readonly [string, string]> = [
  ["America/Toronto", "Toronto / Ottawa / Montréal (Eastern)"],
  ["America/Halifax", "Halifax (Atlantic)"],
  ["America/St_Johns", "St. John's (Newfoundland)"],
  ["America/Winnipeg", "Winnipeg / Regina (Central)"],
  ["America/Edmonton", "Edmonton / Calgary (Mountain)"],
  ["America/Vancouver", "Vancouver (Pacific)"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Shell: a left sub-nav of categories + the selected category on the right.
// Collapses to a horizontal scrolling tab row on narrow widths. Defaults to
// Appearance. Server data arrives as props; everything is bilingual via the
// existing Settings namespace.
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsShell({
  currentLocale,
  currentTimezone,
  autoRejectUnusableDocs,
  isOwner,
  billingEnabled,
  firmName,
}: {
  currentLocale: "fr" | "en";
  currentTimezone: string;
  autoRejectUnusableDocs: boolean;
  isOwner: boolean;
  billingEnabled: boolean;
  firmName: string;
}) {
  const t = useTranslations("Settings");
  const [section, setSection] = useState<SectionId>("appearance");

  const nav: { id: SectionId; label: string; icon: typeof Palette }[] = [
    { id: "appearance", label: t("nav_appearance"), icon: Palette },
    { id: "general", label: t("nav_general"), icon: SlidersHorizontal },
    { id: "documents", label: t("nav_documents"), icon: FileText },
    ...(isOwner
      ? [{ id: "data" as const, label: t("nav_data"), icon: ShieldCheck }]
      : []),
  ];

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
        {section === "appearance" && <AppearanceSection t={t} />}
        {section === "general" && (
          <GeneralSection
            currentLocale={currentLocale}
            currentTimezone={currentTimezone}
            billingEnabled={billingEnabled}
            t={t}
          />
        )}
        {section === "documents" && (
          <DocumentsSection
            autoRejectUnusableDocs={autoRejectUnusableDocs}
            t={t}
          />
        )}
        {section === "data" && isOwner && (
          <DataPrivacySection firmName={firmName} t={t} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Appearance — Mode (Light/Dark/System) + Accent (Blue/Green), each as a
// selectable card with a live preview swatch. The accent cards preview in the
// currently-effective mode (resolvedTheme), so System tracks the OS and
// updates live. All options stay selectable in every mode.
// ─────────────────────────────────────────────────────────────────────────────

function AppearanceSection({ t }: { t: Translate }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const activeMode = (mounted ? theme : "system") as ThemeChoice;
  // The mode the previews should render in. Falls back to light pre-mount.
  const effectiveMode: "light" | "dark" =
    mounted && resolvedTheme === "dark" ? "dark" : "light";

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-sm font-semibold">{t("mode_label")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("mode_hint")}</p>
        <div className="mt-4 grid max-w-lg grid-cols-3 gap-3">
          <OptionCard
            label={t("theme_light")}
            icon={<Sun className="h-3.5 w-3.5" />}
            active={activeMode === "light"}
            onClick={() => setTheme("light")}
            swatch={<ThemeSwatch mode="light" accent={accent} />}
          />
          <OptionCard
            label={t("theme_dark")}
            icon={<Moon className="h-3.5 w-3.5" />}
            active={activeMode === "dark"}
            onClick={() => setTheme("dark")}
            swatch={<ThemeSwatch mode="dark" accent={accent} />}
          />
          <OptionCard
            label={t("theme_system")}
            icon={<Monitor className="h-3.5 w-3.5" />}
            active={activeMode === "system"}
            onClick={() => setTheme("system")}
            swatch={<ThemeSwatch mode={effectiveMode} accent={accent} />}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">{t("accent_label")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("accent_hint")}</p>
        <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
          {(["blue", "green"] as const).map((a) => (
            <OptionCard
              key={a}
              label={t(`accent_${a}`)}
              active={mounted && accent === a}
              onClick={() => setAccent(a)}
              swatch={<ThemeSwatch mode={effectiveMode} accent={a} />}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// Self-contained themed island: applying the mode class + data-accent to this
// wrapper makes the token-based children below render that exact combo,
// independent of the page's current theme. This is what lets the previews be
// honest (Step 5).
function ThemeSwatch({
  mode,
  accent,
}: {
  mode: "light" | "dark";
  accent: Accent;
}) {
  return (
    <div className={mode === "dark" ? "dark" : undefined} data-accent={accent}>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="h-1.5 flex-1 rounded-full bg-card" />
        </div>
        <div className="h-1.5 w-3/4 rounded-full bg-muted" />
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-accent px-1 py-0.5 text-[7px] font-semibold leading-none text-accent-foreground">
            Aa
          </span>
          <span className="h-1.5 flex-1 rounded-full bg-border" />
        </div>
      </div>
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
  billingEnabled,
  t,
}: {
  currentLocale: "fr" | "en";
  currentTimezone: string;
  billingEnabled: boolean;
  t: Translate;
}) {
  return (
    <div className="space-y-10">
      <LanguageSection currentLocale={currentLocale} t={t} />
      <TimezoneSection currentTimezone={currentTimezone} t={t} />
      {billingEnabled && (
        <section>
          <h2 className="text-sm font-semibold">{t("section_billing")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("section_billing_hint")}
          </p>
          <Link
            href="/billing"
            className="mt-4 flex max-w-xl items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
          >
            <span className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <CreditCard className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">
                {t("billing_link_label")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </section>
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
      <div className="mt-4 inline-flex rounded-md border border-border bg-secondary/40 p-0.5">
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
          ? "bg-card text-foreground shadow-sm"
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
            {CA_TIMEZONES.map(([tz, label]) => (
              <SelectItem key={tz} value={tz}>
                {label}
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
  t,
}: {
  autoRejectUnusableDocs: boolean;
  t: Translate;
}) {
  const [enabled, setEnabled] = useState(autoRejectUnusableDocs);
  const [error, setError] = useState<string | null>(null);

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
      <div className="mt-4 flex max-w-xl items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
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
          className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
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
          className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-secondary/30"
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
