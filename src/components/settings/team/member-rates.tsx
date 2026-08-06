"use client";

// HOURLY RATES — what this person costs the firm, and what their hour would
// bill at. A quiet panel on the member's own page, exactly like User access
// beside it: not a settings screen, a control on the object it acts on.
//
// WHO SEES THIS is rates.manage — the capability, never the owner rank. The
// founder, verbatim: "billing rates could be transferred over to, like, a
// senior manager who wants to see how each person is being paid... roles
// only." The page renders this panel only for holders, the action refuses
// non-holders politely, and RLS (1750) refuses them regardless.
//
// COST is what the v1 math uses (margin = revenue − hours × cost). BILLABLE is
// stored-but-unread by design: no v1 surface multiplies it into anything,
// because Vylan bills flat amounts and an hourly-billing UI would be a second
// billing system. The field exists so a future feature starts with data.
//
// A rate CHANGE does not rewrite history: every logged hour keeps the rate
// that was true when it was worked (time_entry_costs snapshot). The hint under
// the fields says so, because "will this change last month's margins?" is the
// first question a careful owner asks.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { setMemberRatesAction } from "@/app/actions/user-rates";

export function MemberRates({
  userId,
  initialCostCents,
  initialBillableCents,
}: {
  userId: string;
  initialCostCents: number | null;
  initialBillableCents: number | null;
}) {
  const t = useTranslations("Team");
  const [pending, startTransition] = useTransition();
  const [costCents, setCostCents] = useState<number | null>(initialCostCents);
  const [billableCents, setBillableCents] = useState<number | null>(
    initialBillableCents,
  );
  const [dirty, setDirty] = useState(false);

  const save = () => {
    startTransition(async () => {
      const res = await setMemberRatesAction({
        userId,
        costRateHourly: costCents == null ? null : costCents / 100,
        billableRateHourly: billableCents == null ? null : billableCents / 100,
      });
      if (res.ok) {
        setDirty(false);
        toast.success(t("rates_saved"));
      } else {
        toast.error(
          res.error === "unsupported"
            ? t("rates_unsupported")
            : t("rates_error"),
        );
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rate-cost">{t("rates_cost_label")}</Label>
          <div className="flex items-center gap-2">
            <MoneyInput
              id="rate-cost"
              valueCents={costCents}
              onChangeCents={(v) => {
                setCostCents(v);
                setDirty(true);
              }}
              placeholder="0.00"
              ariaLabel={t("rates_cost_label")}
            />
            <span className="text-xs text-muted-foreground">
              {t("rates_cad_per_hour")}
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rate-billable">{t("rates_billable_label")}</Label>
          <div className="flex items-center gap-2">
            <MoneyInput
              id="rate-billable"
              valueCents={billableCents}
              onChangeCents={(v) => {
                setBillableCents(v);
                setDirty(true);
              }}
              placeholder="0.00"
              ariaLabel={t("rates_billable_label")}
            />
            <span className="text-xs text-muted-foreground">
              {t("rates_cad_per_hour")}
            </span>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("rates_hint")}</p>
      {dirty && (
        <Button size="sm" onClick={save} disabled={pending}>
          {t("rates_save")}
        </Button>
      )}
    </div>
  );
}
