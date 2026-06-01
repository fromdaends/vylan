"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({
  className = "",
  lightLabel = "Switch to light mode",
  darkLabel = "Switch to dark mode",
}: {
  className?: string;
  // Optional localized aria-labels (the bilingual client portal passes FR/EN).
  lightLabel?: string;
  darkLabel?: string;
}) {
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
      aria-label={isDark ? lightLabel : darkLabel}
      className={
        "relative inline-flex h-8 w-8 items-center justify-center rounded-md " +
        "border border-border bg-card text-muted-foreground " +
        "transition-all duration-200 hover:text-foreground hover:bg-secondary " +
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
