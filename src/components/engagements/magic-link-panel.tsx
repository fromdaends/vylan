"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// `url` is the server-built fallback (uses APP_URL — correct for SSR and for the
// canonical production address). When `token` is provided, after mount we rebuild
// the displayed/copied link from the CURRENT site origin, so it points at
// whatever deployment the accountant is actually viewing (e.g. a Vercel preview),
// not just APP_URL. Emails are built elsewhere from APP_URL, so the canonical
// link a client receives is unaffected.
export function MagicLinkPanel({
  url,
  token,
}: {
  url: string;
  token?: string;
}) {
  const t = useTranslations("Engagements");
  const [copied, setCopied] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(url);

  useEffect(() => {
    if (token && typeof window !== "undefined") {
      setDisplayUrl(`${window.location.origin}/r/${token}`);
    }
  }, [token]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(displayUrl);
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
          {displayUrl}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={t("copy_link")}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}
