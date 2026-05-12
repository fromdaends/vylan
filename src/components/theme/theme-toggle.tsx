"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
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
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
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
