"use client";

// The firm's payment terms — MOVED here from the Billing page's Settings tab
// (founder: "delete billing settings and move it all into actual settings").
//
// ⚠️ THIS ONE IS A MOVE, NOT A DELETION, AND THE DIFFERENCE MATTERS. Every
// other card on that tab was a read-only window onto a control that already
// lived in Settings, so deleting them lost nothing. `default_due_days` had
// exactly ONE editor in the entire repo — this component. Deleting it with the
// others would have quietly removed the only way to change when an invoice
// counts as late, which is also what the whole reminder schedule counts from.
//
// It sits beside InvoiceChaseDefaults in Settings → Automation for two reasons:
// the reminder cadence counts FROM this number, so they read as one idea; and
// Automation is the section that already carries the "editable by money.view,
// not owner-only" exception this control needs (Settings → Payments is
// owner-gated, and landing here would have silently demoted a setting staff
// can edit today).
//
// Same i18n keys, same action, same bounds as before the move — only the
// address changed.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DUE_DAYS_MIN, DUE_DAYS_MAX } from "@/lib/invoices/terms";
import { saveDefaultDueDaysAction } from "@/app/actions/billing-invoices";

export function PaymentTermsDefaults({
  initialDays,
}: {
  initialDays: number | null;
}) {
  const t = useTranslations("FirmBilling");
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(
    initialDays == null ? "" : String(initialDays),
  );

  // A TEXT-ish number whose EMPTINESS is meaningful: "" = no terms at all,
  // "0" = due on receipt. Two different decisions a spinner would blur.
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
