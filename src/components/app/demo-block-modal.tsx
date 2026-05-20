"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Lock } from "lucide-react";
import { BookCallButton } from "@/components/booking/book-call-button";

// Renders a button (same chrome as the real action's button) that
// opens a "demo mode — talk to us" dialog instead of firing the
// real action. Drop this in place of the real CTA when
// `firm.is_demo` is true.
export function DemoBlockButton({
  label,
  icon,
  reasonKey,
  variant = "default",
  size = "default",
}: {
  label: string;
  icon?: ReactNode;
  // Translation key under "Demo" for the action-specific reason
  // line. e.g. "block_add_client_reason" / "block_send_engagement_reason".
  reasonKey?: string;
  variant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("Demo");

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        {icon}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-accent" />
              {t("block_title")}
            </DialogTitle>
            <DialogDescription>
              {reasonKey
                ? t(reasonKey as Parameters<typeof t>[0])
                : t("block_default_reason")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-secondary/40 p-4 text-sm">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-accent mt-0.5 shrink-0" />
              <p className="text-muted-foreground">{t("block_body")}</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <BookCallButton
              label={t("block_cta_book")}
              variant="outline"
            />
            <a
              href="mailto:hello@relai.app?subject=Ready%20to%20subscribe"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {t("block_cta_buy")}
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
