"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock, Unlock, Check, Upload } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/format";
import { requestPaymentWithAttachmentAction } from "@/app/actions/payments";
import {
  unlockDeliverablesAction,
  relockDeliverablesAction,
  waiveInvoiceAction,
  editInvoiceAction,
  updateInvoiceAutomationAction,
} from "@/app/actions/invoices";

export type InvoiceForOptions = {
  id: string;
  status: "requested" | "paid" | "failed" | "canceled";
  amount_cents: number;
  description: string | null;
  locks_deliverables?: boolean;
  override_unlocked?: boolean;
};

export type EngagementInvoiceAutomation = {
  mode: "off" | "on_completion" | "delayed";
  delayDays: number | null;
  amountCents: number | null;
  description: string | null;
  locksDeliverables: boolean;
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
  engagementStatus,
  automation,
  trigger,
}: {
  engagementId: string;
  connectReady: boolean;
  invoice: InvoiceForOptions | null;
  engagementLocksDeliverables: boolean;
  defaultAmount: string;
  locale: "fr" | "en";
  engagementStatus: "live" | "complete" | "cancelled";
  automation: EngagementInvoiceAutomation;
  trigger: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [automationSaved, setAutomationSaved] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);

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
  const [attachment, setAttachment] = useState<File | null>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const automationAttachmentRef = useRef<HTMLInputElement>(null);
  const [automationMode, setAutomationMode] = useState(automation.mode);
  const [automationDelay, setAutomationDelay] = useState(
    String(automation.delayDays ?? 7),
  );
  const [automationAmount, setAutomationAmount] = useState(
    automation.amountCents != null
      ? (automation.amountCents / 100).toFixed(2)
      : defaultAmount,
  );
  const [automationDescription, setAutomationDescription] = useState(
    automation.description ?? "",
  );
  const [automationLock, setAutomationLock] = useState(
    automation.locksDeliverables,
  );
  const [automationAttachment, setAutomationAttachment] = useState<File | null>(
    null,
  );

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
      const formData = new FormData();
      formData.set("engagement_id", engagementId);
      formData.set("amount_cents", String(cents));
      formData.set("description", description.trim());
      formData.set("locks_deliverables", String(lock));
      if (attachment) formData.set("attachment", attachment);
      const res = await requestPaymentWithAttachmentAction(formData);
      if (res.ok) {
        setAttachment(null);
        setOpen(false);
        router.refresh();
      } else {
        setError(
          res.error === "already_invoiced"
            ? t("request_payment_already_invoiced")
            : res.error === "not_connected"
              ? t("invoice_connect_note")
              : res.error === "attachment_too_large"
                ? t("invoice_attachment_too_large")
                : res.error === "attachment_type"
                  ? t("invoice_attachment_type")
                  : res.error === "attachment_upload"
                    ? t("invoice_attachment_upload_error")
                    : t("request_payment_error"),
        );
      }
    });
  }

  function waive() {
    if (!window.confirm(t("lock_waive_confirm"))) return;
    runVoid(waiveInvoiceAction);
  }

  function saveAutomation() {
    setAutomationError(null);
    setAutomationSaved(false);
    const cents = Math.round(Number.parseFloat(automationAmount) * 100);
    if (
      automationMode !== "off" &&
      (!Number.isFinite(cents) || cents < 50)
    ) {
      setAutomationError(t("request_payment_amount_invalid"));
      return;
    }
    const delay = Math.max(1, Math.floor(Number(automationDelay) || 0));
    if (automationMode === "delayed" && delay < 1) {
      setAutomationError(t("invoice_delay_required"));
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("engagement_id", engagementId);
      formData.set("mode", automationMode);
      formData.set("delay_days", String(delay));
      formData.set("amount_cents", String(cents));
      formData.set("description", automationDescription.trim());
      formData.set("locks_deliverables", String(automationLock));
      if (automationAttachment) {
        formData.set("attachment", automationAttachment);
      }
      const result = await updateInvoiceAutomationAction(formData);
      if (!result.ok) {
        setAutomationError(
          result.error === "already_invoiced"
            ? t("invoice_automation_already_sent")
            : result.error === "attachment_too_large"
              ? t("invoice_attachment_too_large")
              : result.error === "attachment_type"
                ? t("invoice_attachment_type")
                : result.error === "attachment_upload"
                  ? t("invoice_attachment_upload_error")
                  : t("invoice_automation_save_error"),
        );
        return;
      }
      setAutomationAttachment(null);
      setAutomationSaved(true);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setSaved(false);
          setAttachment(null);
          setAutomationError(null);
          setAutomationSaved(false);
          setAutomationAttachment(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("invoice_dialog_title")}</DialogTitle>
          <DialogDescription>
            {t("invoice_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="invoice" className="min-w-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="invoice">{t("invoice_tab_now")}</TabsTrigger>
            <TabsTrigger value="automation">
              {t("invoice_tab_automation")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invoice" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {isPaid
                ? t("invoice_paid_note")
                : liveInvoice
                  ? t("invoice_manage_desc")
                  : t("invoice_create_desc")}
            </p>

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
                <div className="space-y-1.5">
                  <Label htmlFor="inv-new-attachment">
                    {t("invoice_attachment")}
                  </Label>
                  <input
                    ref={attachmentRef}
                    id="inv-new-attachment"
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                    onChange={(event) =>
                      setAttachment(event.target.files?.[0] ?? null)
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start font-normal"
                    onClick={() => attachmentRef.current?.click()}
                  >
                    <Upload className="size-4 shrink-0" />
                    <span className="truncate">
                      {attachment?.name ?? t("invoice_attachment_choose")}
                    </span>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t("invoice_attachment_hint")}
                  </p>
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
          </TabsContent>

          <TabsContent value="automation" className="space-y-4 pt-2">
            <div>
              <h3 className="text-sm font-medium">
                {t("invoice_automation_title")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("invoice_automation_desc")}
              </p>
            </div>

            {invoice && invoice.status !== "canceled" ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {t("invoice_automation_already_sent")}
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-auto-mode">
                    {t("invoice_automation_mode_label")}
                  </Label>
                  <Select
                    value={automationMode}
                    onValueChange={(value) => {
                      setAutomationMode(
                        value as EngagementInvoiceAutomation["mode"],
                      );
                      setAutomationSaved(false);
                    }}
                  >
                    <SelectTrigger id="inv-auto-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">
                        {t("invoice_automation_off")}
                      </SelectItem>
                      <SelectItem value="on_completion" disabled={!connectReady}>
                        {t("invoice_automation_on_completion")}
                      </SelectItem>
                      <SelectItem value="delayed" disabled={!connectReady}>
                        {t("invoice_automation_delayed")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {automationMode !== "off" && (
                  <div className="space-y-4">
                    {automationMode === "delayed" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="inv-auto-delay">
                          {t("invoice_automation_delay_label")}
                        </Label>
                        <Input
                          id="inv-auto-delay"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="365"
                          value={automationDelay}
                          onChange={(event) => {
                            setAutomationDelay(event.target.value);
                            setAutomationSaved(false);
                          }}
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="inv-auto-amount">
                        {t("request_payment_amount")}
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          $
                        </span>
                        <Input
                          id="inv-auto-amount"
                          type="number"
                          inputMode="decimal"
                          min="0.50"
                          step="0.01"
                          value={automationAmount}
                          onChange={(event) => {
                            setAutomationAmount(event.target.value);
                            setAutomationSaved(false);
                          }}
                          className="pl-7"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="inv-auto-desc">
                        {t("request_payment_description")}
                      </Label>
                      <Textarea
                        id="inv-auto-desc"
                        value={automationDescription}
                        onChange={(event) => {
                          setAutomationDescription(event.target.value);
                          setAutomationSaved(false);
                        }}
                        rows={2}
                        maxLength={500}
                        placeholder={t("request_payment_description_ph")}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="inv-auto-attachment">
                        {t("invoice_attachment")}
                      </Label>
                      <input
                        ref={automationAttachmentRef}
                        id="inv-auto-attachment"
                        type="file"
                        className="hidden"
                        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                        onChange={(event) =>
                          setAutomationAttachment(
                            event.target.files?.[0] ?? null,
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start font-normal"
                        onClick={() => automationAttachmentRef.current?.click()}
                      >
                        <Upload className="size-4 shrink-0" />
                        <span className="truncate">
                          {automationAttachment?.name ??
                            t("invoice_attachment_choose")}
                        </span>
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {t("invoice_attachment_hint")}
                      </p>
                    </div>

                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={automationLock}
                        onChange={(event) => {
                          setAutomationLock(event.target.checked);
                          setAutomationSaved(false);
                        }}
                      />
                      <span>
                        <span className="block">{t("invoice_lock_label")}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t("invoice_lock_hint")}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {!connectReady && automationMode === "off" && (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    {t("invoice_connect_note")}
                  </p>
                )}

                {engagementStatus === "complete" && automationMode !== "off" && (
                  <p className="text-xs text-muted-foreground">
                    {t("invoice_automation_complete_note")}
                  </p>
                )}

                {automationError && (
                  <p className="text-sm text-destructive">{automationError}</p>
                )}
                {automationSaved && (
                  <p className="text-sm text-success">
                    {t("invoice_automation_saved")}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={saveAutomation}
                  disabled={pending}
                  className="w-full"
                >
                  {t("invoice_automation_save")}
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
