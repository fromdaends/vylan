"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// Copies the client's portal URL (where the Pay now card lives) to the
// clipboard. Useful on a completed engagement, whose portal link is otherwise
// hidden in the accountant view. Mirrors MagicLinkPanel's copy logic.
export function CopyPaymentLink({ url }: { url: string }) {
  const t = useTranslations("Engagements");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the link still exists; nothing to do.
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      aria-label={t("copy_payment_link")}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? t("copied") : t("copy_payment_link")}
    </Button>
  );
}
