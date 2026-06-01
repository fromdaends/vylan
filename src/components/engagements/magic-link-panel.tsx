"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MagicLinkPanel({ url }: { url: string }) {
  const t = useTranslations("Engagements");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — user can still select manually.
    }
  }

  return (
    <div className="space-y-2 border-l-2 border-success/50 pl-4">
      <h3 className="text-base font-semibold tracking-tight text-foreground">
        {t("magic_link_title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("magic_link_hint")}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-secondary/50 px-3 py-2 text-xs font-mono break-all">
          {url}
        </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            aria-label={t("copy_link")}
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
    </div>
  );
}
