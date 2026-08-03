"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowUpRight } from "lucide-react";
import {
  CHASE_INTERVAL_MIN,
  CHASE_INTERVAL_MAX,
  CHASE_MAX_MIN,
  CHASE_MAX_MAX,
  type ChaseSettings,
} from "@/lib/invoices/chase-settings";
import { DUE_DAYS_MIN, DUE_DAYS_MAX } from "@/lib/invoices/terms";
import {
  saveChaseSettingsAction,
  saveDefaultDueDaysAction,
} from "@/app/actions/billing-invoices";

// The Settings tab.
//
// Only ONE thing here is editable: the reminder cadence, which is genuinely new
// and has nowhere else to live. Everything else is a READ-ONLY window onto
// configuration that already exists elsewhere, with a link to it. That is the
// whole point of the section per the spec — a second place to set the GST rate
// is a second place for it to be wrong.
export function BillingSettings({
  chase,
  defaultDueDays,
  taxProvince,
  invoicingConfigured,
  numbering,
  rails,
  books,
}: {
  chase: ChaseSettings;
  // null = the firm has chosen not to date its invoices at all. Distinct from
  // 0, which means due on receipt.
  defaultDueDays: number | null;
  taxProvince: string | null;
  invoicingConfigured: boolean;
  numbering: { prefix: string; nextNumber: string } | null;
  rails: { stripe: boolean; paypal: boolean };
  books: { quickbooks: boolean; xero: boolean };
}) {
  const t = useTranslations("FirmBilling");
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(chase.enabledDefault);
  const [interval, setInterval] = useState(String(chase.intervalDays));
  const [max, setMax] = useState(String(chase.maxReminders));

  const intervalNum = Number(interval);
  const maxNum = Number(max);
  const valid =
    Number.isInteger(intervalNum) &&
    intervalNum >= CHASE_INTERVAL_MIN &&
    intervalNum <= CHASE_INTERVAL_MAX &&
    Number.isInteger(maxNum) &&
    maxNum >= CHASE_MAX_MIN &&
    maxNum <= CHASE_MAX_MAX;

  const save = () => {
    if (!valid) return;
    startTransition(async () => {
      const res = await saveChaseSettingsAction({
        enabledDefault: enabled,
        intervalDays: intervalNum,
        maxReminders: maxNum,
      });
      toast[res.ok ? "success" : "error"](
        res.ok ? t("settings_saved") : t("settings_save_err"),
      );
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Payment terms ─────────────────────────────────────────────
          First card because it is the one that switches everything else on:
          without a due date nothing can be overdue, so the Overdue card, the
          warning rows and the chase cadence all sit inert. */}
      <PaymentTermsCard initialDays={defaultDueDays} />

      {/* ── The other editable thing ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings_reminders_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {t("settings_reminders_body")}
          </p>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="chase-on" className="font-normal">
              {t("settings_reminders_enabled")}
            </Label>
            <Switch
              id="chase-on"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="chase-interval">
                {t("settings_reminders_interval")}
              </Label>
              <Input
                id="chase-interval"
                type="number"
                min={CHASE_INTERVAL_MIN}
                max={CHASE_INTERVAL_MAX}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                disabled={!enabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chase-max">{t("settings_reminders_max")}</Label>
              <Input
                id="chase-max"
                type="number"
                min={CHASE_MAX_MIN}
                max={CHASE_MAX_MAX}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                disabled={!enabled}
              />
            </div>
          </div>

          {/* Says the cadence back in a sentence, because "7" and "4" in two
              boxes do not read as "then every week, four times". */}
          {valid && enabled && (
            <p className="text-xs text-muted-foreground">
              {t("settings_reminders_summary", {
                days: intervalNum,
                max: maxNum,
              })}
            </p>
          )}

          <Button onClick={save} disabled={pending || !valid} size="sm">
            {t("settings_save")}
          </Button>
        </CardContent>
      </Card>

      {/* ── Read-only windows onto configuration that lives elsewhere ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings_taxes_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("settings_taxes_body")}
          </p>
          {invoicingConfigured ? (
            <dl className="text-sm">
              <div className="flex items-center justify-between border-t border-border/50 py-2">
                <dt className="text-muted-foreground">
                  {t("settings_taxes_province")}
                </dt>
                <dd className="font-medium">{taxProvince}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm">{t("settings_taxes_none")}</p>
          )}
          <SettingsLink href="/settings?tab=payments">
            {t("settings_taxes_link")}
          </SettingsLink>
        </CardContent>
      </Card>

      {numbering && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("settings_numbering_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="text-sm">
              <div className="flex items-center justify-between border-t border-border/50 py-2">
                <dt className="text-muted-foreground">
                  {t("settings_numbering_prefix")}
                </dt>
                <dd className="font-mono">{numbering.prefix}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              {t("settings_numbering_preview", { number: numbering.nextNumber })}
            </p>
            <SettingsLink href="/settings?tab=payments">
              {t("settings_taxes_link")}
            </SettingsLink>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings_rails_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="text-sm">
            <div className="flex items-center justify-between border-t border-border/50 py-2">
              <dt>{t("settings_rails_stripe")}</dt>
              <dd>
                <ConnectionStatus on={rails.stripe} />
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border/50 py-2">
              <dt>{t("settings_rails_paypal")}</dt>
              <dd>
                <ConnectionStatus on={rails.paypal} />
              </dd>
            </div>
          </dl>
          <SettingsLink href="/settings?tab=payments">
            {t("settings_rails_link")}
          </SettingsLink>
        </CardContent>
      </Card>

      {/* The honest note the Phase 0 audit forced. Vylan posts NOTHING about
          the firm's own invoices to QuickBooks or Xero — the connected ledger
          is for the firm's CLIENTS' books. Saying so here is cheaper than a
          founder discovering it at year end. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings_books_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="text-sm">
            <div className="flex items-center justify-between border-t border-border/50 py-2">
              <dt>QuickBooks</dt>
              <dd>
                <ConnectionStatus on={books.quickbooks} />
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border/50 py-2">
              <dt>Xero</dt>
              <dd>
                <ConnectionStatus on={books.xero} />
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            {t("settings_books_note")}
          </p>
          <SettingsLink href="/settings?tab=integrations">
            {t("settings_books_link")}
          </SettingsLink>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings_refunds_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("settings_refunds_note")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// "New invoices are due in N days."
//
// An EMPTY field is a real answer, not a missing one: it means "don't put a due
// date on my invoices", and it saves as null. Zero is also real and means due
// on receipt. Those two being different is the whole reason this is a text
// input whose emptiness is meaningful rather than a number spinner.
//
// Changing this only affects invoices raised from now on. An issued invoice
// keeps the date it was issued with — moving a client's due date retroactively
// because someone edited a setting would be indefensible.
function PaymentTermsCard({ initialDays }: { initialDays: number | null }) {
  const t = useTranslations("FirmBilling");
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    initialDays == null ? "" : String(initialDays),
  );

  const trimmed = value.trim();
  const asNumber = Number(trimmed);
  const parsed: number | null = trimmed === "" ? null : asNumber;
  const valid =
    parsed === null ||
    (Number.isInteger(asNumber) &&
      asNumber >= DUE_DAYS_MIN &&
      asNumber <= DUE_DAYS_MAX);

  const save = () => {
    if (!valid) return;
    startTransition(async () => {
      const res = await saveDefaultDueDaysAction(parsed);
      toast[res.ok ? "success" : "error"](
        res.ok ? t("settings_saved") : t("settings_save_err"),
      );
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("settings_terms_title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("settings_terms_body")}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="due-days">{t("settings_terms_days")}</Label>
          <Input
            id="due-days"
            type="number"
            min={DUE_DAYS_MIN}
            max={DUE_DAYS_MAX}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-32"
            placeholder={t("settings_terms_none_placeholder")}
          />
          {/* Says the setting back as a sentence, because "0" and "" in a
              number box do not read as two different decisions. */}
          <p className="text-xs text-muted-foreground">
            {parsed === null
              ? t("settings_terms_summary_none")
              : parsed === 0
                ? t("settings_terms_summary_receipt")
                : t("settings_terms_summary", { days: parsed })}
          </p>
        </div>

        <Button onClick={save} disabled={pending || !valid} size="sm">
          {t("settings_save")}
        </Button>
      </CardContent>
    </Card>
  );
}

// Module scope, not defined inside the render: a component created during
// render is a new type on every pass, so React remounts it and throws away its
// state each time (react-hooks/static-components catches exactly this).
function ConnectionStatus({ on }: { on: boolean }) {
  const t = useTranslations("FirmBilling");
  return (
    <Badge variant="outline" className="font-normal">
      {on ? t("settings_connected") : t("settings_not_connected")}
    </Badge>
  );
}

function SettingsLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}
