"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// Owner-only editor for per-service default payment prices. The accountant sets
// a price once per engagement type and the Request-payment dialog pre-fills it.
// Stored in cents on firms.service_prices; shown/edited here in dollars.
const TYPES = ["t1", "t2", "bookkeeping"] as const;
type ServiceType = (typeof TYPES)[number];

function centsToInput(cents: number | undefined): string {
  return typeof cents === "number" && cents > 0 ? (cents / 100).toFixed(2) : "";
}

export function PaymentsServicePrices({
  prices,
}: {
  prices: Record<string, number>;
}) {
  const t = useTranslations("Settings");
  const [values, setValues] = useState<Record<ServiceType, string>>({
    t1: centsToInput(prices.t1),
    t2: centsToInput(prices.t2),
    bookkeeping: centsToInput(prices.bookkeeping),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const out: Record<string, number> = {};
    for (const type of TYPES) {
      const v = values[type].trim();
      if (v === "") continue;
      const cents = Math.round(Number.parseFloat(v) * 100);
      if (Number.isFinite(cents) && cents > 0) out[type] = cents;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/firm/service-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prices: out }),
        });
        if (!res.ok) {
          setError(t("service_prices_error"));
          return;
        }
        toast.success(t("service_prices_saved"));
      } catch {
        setError(t("service_prices_error"));
      }
    });
  }

  const labels: Record<ServiceType, string> = {
    t1: t("service_price_t1"),
    t2: t("service_price_t2"),
    bookkeeping: t("service_price_bookkeeping"),
  };

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("service_prices_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("service_prices_hint")}
      </p>
      <div className="mt-4 max-w-xl space-y-3 rounded-lg border border-border/50 p-4">
        {TYPES.map((type) => (
          <div
            key={type}
            className="flex items-center justify-between gap-4"
          >
            <Label htmlFor={`sp-${type}`} className="text-sm font-normal">
              {labels[type]}
            </Label>
            <div className="relative w-36">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id={`sp-${type}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={values[type]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [type]: e.target.value }))
                }
                className="pl-7 pr-10 text-right"
                placeholder="0.00"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                CAD
              </span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-end gap-3 pt-1">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "…" : t("service_prices_save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
