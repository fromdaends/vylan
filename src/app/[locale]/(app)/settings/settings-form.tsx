"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Moon, Sun, Monitor, Check } from "lucide-react";
import { updateLocaleAction } from "@/app/actions/profile";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ThemeChoice = "light" | "dark" | "system";

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

export function SettingsForm({
  currentLocale,
  currentTimezone,
  autoRejectUnusableDocs,
}: {
  currentLocale: "fr" | "en";
  currentTimezone: string;
  autoRejectUnusableDocs: boolean;
}) {
  const t = useTranslations("Settings");

  return (
    <div className="space-y-10">
      <AppearanceSection t={t} />
      <LanguageSection currentLocale={currentLocale} t={t} />
      <TimezoneSection currentTimezone={currentTimezone} t={t} />
      <FirmPreferencesSection
        autoRejectUnusableDocs={autoRejectUnusableDocs}
        t={t}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────

function AppearanceSection({ t }: { t: (k: string) => string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes hydration guard — `theme` is undefined on the server, so
  // we render a neutral state until after mount. Fires once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const active = (mounted ? theme : "system") as ThemeChoice;

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_theme")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_theme_hint")}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2 max-w-sm">
        <ThemeCard
          icon={<Sun className="h-4 w-4" />}
          label={t("theme_light")}
          active={active === "light"}
          onClick={() => setTheme("light")}
        />
        <ThemeCard
          icon={<Moon className="h-4 w-4" />}
          label={t("theme_dark")}
          active={active === "dark"}
          onClick={() => setTheme("dark")}
        />
        <ThemeCard
          icon={<Monitor className="h-4 w-4" />}
          label={t("theme_system")}
          active={active === "system"}
          onClick={() => setTheme("system")}
        />
      </div>
    </section>
  );
}

function ThemeCard({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "relative flex flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-colors " +
        (active
          ? "border-foreground/40 bg-secondary text-foreground"
          : "border-border hover:border-foreground/20 text-muted-foreground hover:text-foreground")
      }
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      {active && (
        <Check className="absolute top-1.5 right-1.5 h-3 w-3 text-foreground" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI language (writes to users.locale + flips URL prefix)
// ─────────────────────────────────────────────────────────────────────────────

function LanguageSection({
  currentLocale,
  t,
}: {
  currentLocale: "fr" | "en";
  t: (k: string) => string;
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
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_language_hint")}
      </p>
      <div className="mt-4 inline-flex rounded-md border border-border p-0.5 bg-secondary/40">
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
      className={
        "px-3 py-1.5 text-sm rounded-md transition-colors " +
        (active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Firm timezone — used when Vylan schedules reminders and renders
// times in client emails/SMS. Saves through POST /api/firm/timezone so
// the surrounding RSC tree doesn't re-render mid-save (same reasoning
// as the auto-reject toggle below). Optimistic state; revert on error.
// ─────────────────────────────────────────────────────────────────────────────

function TimezoneSection({
  currentTimezone,
  t,
}: {
  currentTimezone: string;
  t: (k: string) => string;
}) {
  const [value, setValue] = useState(currentTimezone);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next); // optimistic
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
      <p className="text-xs text-muted-foreground mt-1">
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
// AI — currently just the auto-reject-unusable-docs toggle. Future AI
// settings (model preferences, confidence thresholds, etc.) go inside
// the same section.
//
// Zero-lag toggle: the local `setEnabled(next)` flip happens
// synchronously on click, so the switch visually moves before the
// network request even leaves the browser. The Switch is
// intentionally NOT `disabled` during the in-flight fetch — the
// previous `disabled={pending}` triggered the component's
// `disabled:opacity-50` style, which read as a 200-400ms lag while
// the fetch resolved. On failure we revert the local state and show
// an inline error; on rapid double-clicks the optimistic state
// always tracks the user's latest click and the server applies
// last-write-wins.
// ─────────────────────────────────────────────────────────────────────────────

function FirmPreferencesSection({
  autoRejectUnusableDocs,
  t,
}: {
  autoRejectUnusableDocs: boolean;
  t: (k: string) => string;
}) {
  const [enabled, setEnabled] = useState(autoRejectUnusableDocs);
  const [error, setError] = useState<string | null>(null);

  async function onToggle(next: boolean) {
    setError(null);
    setEnabled(next); // optimistic
    // Plain fetch instead of a Server Action: Server Actions trigger
    // an automatic re-render of the surrounding RSC tree, and a
    // throw anywhere in that re-render surfaces here as an opaque
    // "Server Components render" error in production. A regular POST
    // keeps the toggle save independent of the page render.
    try {
      const res = await fetch("/api/firm/auto-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setError(t("save_failed"));
        setEnabled(!next); // revert
      }
    } catch (e) {
      console.error("[onToggle] auto-reject save failed:", e);
      setError(t("save_failed"));
      setEnabled(!next); // revert
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_ai")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_ai_hint")}
      </p>
      <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 max-w-xl">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {t("auto_reject_label")}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("auto_reject_help")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={t("auto_reject_label")}
        />
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}
    </section>
  );
}
