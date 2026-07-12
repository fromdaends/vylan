"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestPaymentAction } from "@/app/actions/payments";
import { toast } from "sonner";

// Optional "Request payment" action on a completed engagement. Opens a small
// dialog (amount + optional description + delivery choice) and records a
// payment request. The client actually pays in Phase 4. Only rendered when the
// firm has Stripe Connect ready (gated by the server).
export function RequestPaymentButton({
  engagementId,
  defaultAmount,
  trigger,
}: {
  engagementId: string;
  // Pre-filled dollar amount as a string ("350.00"), or "" for empty.
  defaultAmount: string;
  // Optional menu-row trigger; the engagement header uses this to keep the
  // payment action inside its three-dot overflow menu.
  trigger?: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultAmount);
  const [description, setDescription] = useState("");
  const [delivery, setDelivery] = useState<"portal" | "email" | "both">("both");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const dollars = Number.parseFloat(amount);
    const cents = Math.round(dollars * 100);
    if (!Number.isFinite(cents) || cents < 50) {
      setError(t("request_payment_amount_invalid"));
      return;
    }
    startTransition(async () => {
      const res = await requestPaymentAction({
        engagementId,
        amountCents: cents,
        description: description.trim() || undefined,
        delivery,
      });
      if (res.ok) {
        setOpen(false);
        setDescription("");
        toast.success(t("request_payment_success"));
        router.refresh();
      } else {
        setError(t("request_payment_error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Wallet className="size-4" />
            {t("request_payment")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("request_payment_title")}</DialogTitle>
          <DialogDescription>{t("request_payment_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rp-amount">{t("request_payment_amount")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="rp-amount"
                type="number"
                inputMode="decimal"
                min="0.50"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7 pr-12"
                placeholder="0.00"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                CAD
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-desc">{t("request_payment_description")}</Label>
            <Textarea
              id="rp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={t("request_payment_description_ph")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-delivery">{t("request_payment_delivery")}</Label>
            <Select
              value={delivery}
              onValueChange={(v) =>
                setDelivery(v as "portal" | "email" | "both")
              }
            >
              <SelectTrigger id="rp-delivery" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">
                  {t("request_payment_delivery_both")}
                </SelectItem>
                <SelectItem value="portal">
                  {t("request_payment_delivery_portal")}
                </SelectItem>
                <SelectItem value="email">
                  {t("request_payment_delivery_email")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("request_payment_cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "…" : t("request_payment_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
