"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({
  className = "",
  lightLabel,
  darkLabel,
  onDark = false,
}: {
  className?: string;
  // Optional localized aria-labels. When omitted they fall back to the shared
  // Common.* translations so the label follows the UI language; the bilingual
  // client portal still passes its own FR/EN strings explicitly.
  lightLabel?: string;
  darkLabel?: string;
  // Sitting on a permanently near-black surface (the client portal's firm
  // header) rather than a themed one. The default token colours — bg-card,
  // border-border, text-muted-foreground — resolve to LIGHT values in light
  // mode, which is invisible on black; this swaps them for fixed white alphas.
  // A prop rather than `!important` overrides from the caller, since Tailwind
  // utility conflicts resolve by stylesheet order, not by string order.
  onDark?: boolean;
}) {
  const tc = useTranslations("Common");
  const light = lightLabel ?? tc("switch_to_light");
  const dark = darkLabel ?? tc("switch_to_dark");
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Standard next-themes hydration guard: theme isn't known on the server,
  // so we render a neutral icon until after mount to avoid a hydration
  // mismatch. The cascading-render warning doesn't apply — this fires
  // exactly once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  function toggle() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? light : dark}
      className={
        "relative inline-flex h-8 w-8 items-center justify-center rounded-md " +
        (onDark
          ? "border border-white/20 bg-transparent text-white/70 hover:bg-white/10 hover:text-white "
          : "border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary ") +
        "transition-all duration-200 " +
        "active:scale-95 " +
        className
      }
    >
      {/* Both icons rendered, only one visible — avoids hydration flash */}
      <Sun
        className={
          "h-4 w-4 transition-all duration-300 " +
          (isDark
            ? "rotate-90 scale-0 opacity-0"
            : "rotate-0 scale-100 opacity-100")
        }
        aria-hidden
      />
      <Moon
        className={
          "absolute h-4 w-4 transition-all duration-300 " +
          (isDark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-0 opacity-0")
        }
        aria-hidden
      />
    </button>
  );
}
