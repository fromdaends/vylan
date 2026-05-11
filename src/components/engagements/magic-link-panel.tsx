"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card className="border-success/40 bg-success/5">
      <CardHeader>
        <CardTitle className="text-base">{t("magic_link_title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("magic_link_hint")}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-xs font-mono break-all">
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
      </CardContent>
    </Card>
  );
}
