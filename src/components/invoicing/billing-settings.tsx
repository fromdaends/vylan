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
import { saveChaseSettingsAction } from "@/app/actions/billing-invoices";

// The Settings tab.
//
// Only ONE thing here is editable: the reminder cadence, which is genuinely new
// and has nowhere else to live. Everything else is a READ-ONLY window onto
// configuration that already exists elsewhere, with a link to it. That is the
// whole point of the section per the spec — a second place to set the GST rate
// is a second place for it to be wrong.
export function BillingSettings({
  chase,
  taxProvince,
  invoicingConfigured,
  numbering,
  rails,
  books,
}: {
  chase: ChaseSettings;
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
      {/* ── The one editable thing ───────────────────────────────────── */}
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
