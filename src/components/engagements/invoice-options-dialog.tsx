"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock, Unlock, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { requestPaymentAction } from "@/app/actions/payments";
import {
  unlockDeliverablesAction,
  relockDeliverablesAction,
  waiveInvoiceAction,
  editInvoiceAction,
} from "@/app/actions/invoices";

export type InvoiceForOptions = {
  id: string;
  status: "requested" | "paid" | "failed" | "canceled";
  amount_cents: number;
  description: string | null;
  locks_deliverables?: boolean;
  override_unlocked?: boolean;
};

// The single place to manage an engagement's invoice, opened from the "..." menu.
// Consolidates: create (when none), view, edit the amount/description, lock or
// unlock the Final documents, and waive — so the header row stays clean.
export function InvoiceOptionsDialog({
  engagementId,
  connectReady,
  invoice,
  engagementLocksDeliverables,
  defaultAmount,
  locale,
  trigger,
}: {
  engagementId: string;
  connectReady: boolean;
  invoice: InvoiceForOptions | null;
  engagementLocksDeliverables: boolean;
  defaultAmount: string;
  locale: "fr" | "en";
  trigger: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const liveInvoice =
    invoice && (invoice.status === "requested" || invoice.status === "failed")
      ? invoice
      : null;
  const isPaid = invoice?.status === "paid";

  // Editable fields (live invoice) or create fields (no live invoice).
  const [amount, setAmount] = useState(
    liveInvoice ? (liveInvoice.amount_cents / 100).toFixed(2) : defaultAmount,
  );
  const [description, setDescription] = useState(liveInvoice?.description ?? "");
  const [lock, setLock] = useState(false);

  const invoiceLocked = liveInvoice
    ? liveInvoice.locks_deliverables === true &&
      liveInvoice.override_unlocked !== true
    : engagementLocksDeliverables;

  function runVoid(action: (fd: FormData) => Promise<void>) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("engagement_id", engagementId);
      await action(fd);
      router.refresh();
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    const cents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 50) {
      setError(t("request_payment_amount_invalid"));
      return;
    }
    startTransition(async () => {
      const res = await editInvoiceAction({
        engagementId,
        amountCents: cents,
        description: description.trim() || undefined,
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(t("invoice_edit_error"));
      }
    });
  }

  function create() {
    setError(null);
    const cents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 50) {
      setError(t("request_payment_amount_invalid"));
      return;
    }
    startTransition(async () => {
      const res = await requestPaymentAction({
        engagementId,
        amountCents: cents,
        description: description.trim() || undefined,
        delivery: "both",
        locksDeliverables: lock,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(
          res.error === "already_invoiced"
            ? t("request_payment_already_invoiced")
            : res.error === "not_connected"
              ? t("invoice_connect_note")
              : t("request_payment_error"),
        );
      }
    });
  }

  function waive() {
    if (!window.confirm(t("lock_waive_confirm"))) return;
    runVoid(waiveInvoiceAction);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setSaved(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("invoice_dialog_title")}</DialogTitle>
          <DialogDescription>
            {isPaid
              ? t("invoice_paid_note")
              : liveInvoice
                ? t("invoice_manage_desc")
                : t("invoice_create_desc")}
          </DialogDescription>
        </DialogHeader>

        {/* Paid: view-only */}
        {isPaid && invoice && (
          <div className="rounded-lg border border-success/30 bg-success/[0.06] p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-success">
              <Check className="size-4" />
              {t("invoice_status_paid")} ·{" "}
              {formatCurrency(invoice.amount_cents / 100, locale)}
            </div>
            {invoice.description && (
              <p className="mt-1 text-muted-foreground">
                {invoice.description}
              </p>
            )}
          </div>
        )}

        {/* Live invoice: edit + lock + waive */}
        {liveInvoice && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-amount">{t("request_payment_amount")}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="inv-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.50"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setSaved(false);
                  }}
                  className="pl-7"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-desc">
                {t("request_payment_description")}
              </Label>
              <Textarea
                id="inv-desc"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setSaved(false);
                }}
                rows={2}
                maxLength={500}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={save}
              disabled={pending}
            >
              {saved ? (
                <>
                  <Check className="size-4" /> {t("invoice_saved")}
                </>
              ) : (
                t("invoice_save")
              )}
            </Button>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm">
                {invoiceLocked ? (
                  <Lock className="size-4 text-muted-foreground" />
                ) : (
                  <Unlock className="size-4 text-muted-foreground" />
                )}
                <span>
                  {t("invoice_finals_label")}:{" "}
                  <span className="font-medium">
                    {invoiceLocked
                      ? t("invoice_locked_state")
                      : t("invoice_unlocked_state")}
                  </span>
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  runVoid(
                    invoiceLocked
                      ? unlockDeliverablesAction
                      : relockDeliverablesAction,
                  )
                }
              >
                {invoiceLocked ? t("lock_unlock") : t("invoice_lock_now")}
              </Button>
            </div>

            <div className="flex justify-end border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={pending}
                onClick={waive}
              >
                {t("lock_waive")}
              </Button>
            </div>
          </div>
        )}

        {/* No live invoice: create (and, if fallback-locked, an unlock). */}
        {!liveInvoice && !isPaid && (
          <div className="space-y-4">
            {engagementLocksDeliverables && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Lock className="size-4 text-muted-foreground" />
                  <span>{t("invoice_finals_fallback_locked")}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => runVoid(unlockDeliverablesAction)}
                >
                  {t("lock_unlock")}
                </Button>
              </div>
            )}
            {connectReady ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-new-amount">
                    {t("request_payment_amount")}
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="inv-new-amount"
                      type="number"
                      inputMode="decimal"
                      min="0.50"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pl-7"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-new-desc">
                    {t("request_payment_description")}
                  </Label>
                  <Textarea
                    id="inv-new-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder={t("request_payment_description_ph")}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={lock}
                    onChange={(e) => setLock(e.target.checked)}
                  />
                  <span>
                    <span className="block">{t("invoice_lock_label")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("invoice_lock_hint")}
                    </span>
                  </span>
                </label>
                <Button
                  type="button"
                  onClick={create}
                  disabled={pending}
                  className="w-full"
                >
                  {t("invoice_create")}
                </Button>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                {t("invoice_connect_note")}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
