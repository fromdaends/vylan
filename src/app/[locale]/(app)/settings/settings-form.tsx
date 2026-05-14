"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Moon, Sun, Monitor, Check } from "lucide-react";
import { updateLocaleAction } from "@/app/actions/profile";

type ThemeChoice = "light" | "dark" | "system";

export function SettingsForm({
  currentLocale,
}: {
  currentLocale: "fr" | "en";
}) {
  const t = useTranslations("Settings");

  return (
    <div className="space-y-10">
      <AppearanceSection t={t} />
      <LanguageSection currentLocale={currentLocale} t={t} />
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
