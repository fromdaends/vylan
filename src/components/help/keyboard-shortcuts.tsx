"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Power-user shortcuts available on the accountant side. Listens at the
// document level and ignores keystrokes when an input/textarea/select is
// focused, so we never hijack typing.

const SHORTCUT_TIMEOUT_MS = 800;

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Help");
  const [showHelp, setShowHelp] = useState(false);
  const lastKeyRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't capture while typing.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Two-key "g <X>" chord. Track the last 'g' press, then check the next.
      const now = Date.now();
      const last = lastKeyRef.current;
      const isFresh = last && now - last.at < SHORTCUT_TIMEOUT_MS;
      if (isFresh && last?.key === "g") {
        lastKeyRef.current = null;
        if (e.key === "d") {
          e.preventDefault();
          router.push("/dashboard");
          return;
        }
        if (e.key === "c") {
          e.preventDefault();
          router.push("/clients");
          return;
        }
        if (e.key === "t") {
          e.preventDefault();
          router.push("/templates");
          return;
        }
        if (e.key === "s") {
          e.preventDefault();
          router.push("/settings");
          return;
        }
        return;
      }
      if (e.key === "g") {
        lastKeyRef.current = { key: "g", at: now };
        return;
      }

      // Single-key shortcuts.
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((p) => !p);
        return;
      }
      if (e.key === "c" && !isFresh) {
        e.preventDefault();
        router.push("/engagements/new");
        return;
      }
      if (e.key === "/") {
        // Only do something meaningful on /clients (focus search).
        if (pathname?.endsWith("/clients") || pathname === "/clients") {
          e.preventDefault();
          const search = document.querySelector<HTMLInputElement>(
            'input[type="search"]',
          );
          search?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, pathname]);

  return (
    <Dialog open={showHelp} onOpenChange={setShowHelp}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts_title")}</DialogTitle>
          <DialogDescription>{t("shortcuts_subtitle")}</DialogDescription>
        </DialogHeader>
        <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Kbd>c</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_create")}</dd>
          <Kbd>/</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_search")}</dd>
          <Kbd>g d</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_dash")}</dd>
          <Kbd>g c</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_clients")}</dd>
          <Kbd>g t</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_templates")}</dd>
          <Kbd>g s</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_settings")}</dd>
          <Kbd>?</Kbd>
          <dd className="text-muted-foreground">{t("shortcut_help")}</dd>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <dt>
      <kbd className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
        {children}
      </kbd>
    </dt>
  );
}
