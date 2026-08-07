"use client";

// The firm's invoice-reminder defaults — MOVED here from the Billing page's
// Settings tab (founder: "automated reminders for invoices must be moved into
// there as well... It should be in automations"). Settings → Automation is
// where every firm-wide chase default lives now; Billing keeps a read-only
// window pointing here, per its own "editable in one place" doctrine.
//
// Same i18n keys, same action, same bounds as before the move — the words and
// the behaviour did not change, only the address.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CHASE_INTERVAL_MIN,
  CHASE_INTERVAL_MAX,
  CHASE_MAX_MIN,
  CHASE_MAX_MAX,
  type ChaseSettings,
} from "@/lib/invoices/chase-settings";
import { saveChaseSettingsAction } from "@/app/actions/billing-invoices";

export function InvoiceChaseDefaults({ chase }: { chase: ChaseSettings }) {
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
    <Card className="max-w-2xl">
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
          <Switch id="chase-on" checked={enabled} onCheckedChange={setEnabled} />
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
  );
}
