"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { MANUAL_PAYMENT_METHODS } from "@/lib/invoices/filters";
import { recordPaymentAction } from "@/app/actions/billing-invoices";
import type { InvoiceListRow } from "@/lib/invoices/list";

// Record money that arrived outside the payment link.
//
// The amount defaults to the FULL remaining balance, because that is what
// happens the overwhelming majority of the time — a partial is the exception
// and should cost a deliberate edit, not the other way round.
//
// The partial warning is not decoration. Vylan's portal payment link always
// charges the invoice total (the spec keeps the client experience untouched),
// so a client who is told "you still owe $200" and then uses their old link
// pays the whole $1,000 again. The firm has to know that before they close
// this dialog, and a refund is the only way back.
export function RecordPaymentDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: InvoiceListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("FirmBilling");
  const locale = (useLocale() === "fr" ? "fr" : "en") as AppLocale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const owed = invoice.outstandingCents;
  const [amount, setAmount] = useState((owed / 100).toFixed(2));
  const [method, setMethod] = useState<string>("interac");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");

  const enteredCents = Math.round(Number(amount) * 100);
  const validAmount =
    Number.isFinite(enteredCents) && enteredCents > 0 && enteredCents <= owed;
  const isPartial = validAmount && enteredCents < owed;

  const submit = () => {
    if (!validAmount) {
      toast.error(t("record_err_invalid_amount"));
      return;
    }
    startTransition(async () => {
      const res = await recordPaymentAction({
        invoiceId: invoice.id,
        amountCents: enteredCents,
        method,
        paidOn,
        reference: reference.trim() || null,
      });
      if (!res.ok) {
        const key = `record_err_${res.reason}`;
        // Fall back to the generic message for a reason with no copy of its
        // own, rather than rendering a raw enum value at the accountant.
        const known = [
          "invalid_amount",
          "invalid_date",
          "already_paid",
          "voided",
          "migration_pending",
        ].includes(res.reason);
        toast.error(known ? t(key) : t("record_err_generic"));
        return;
      }
      toast.success(
        res.settled
          ? t("record_ok_settled")
          : t("record_ok_partial", {
              amount: formatCurrency(res.outstandingCents / 100, locale),
            }),
      );
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("record_title")}</DialogTitle>
          <DialogDescription>{t("record_subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rp-amount">{t("record_amount")}</Label>
            <Input
              id="rp-amount"
              type="number"
              step="0.01"
              min="0"
              max={(owed / 100).toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              {t("record_amount_hint", {
                amount: formatCurrency(owed / 100, locale),
              })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-method">{t("record_method")}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="rp-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`method_${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-date">{t("record_date")}</Label>
            <Input
              id="rp-date"
              type="date"
              value={paidOn}
              // A payment cannot have arrived in the future, and the browser
              // can say so before the server has to.
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-ref">{t("record_reference")}</Label>
            <Input
              id="rp-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("record_reference_placeholder")}
              maxLength={300}
            />
          </div>

          {isPartial && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              {t("record_partial_warning")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !validAmount}>
            {t("record_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
