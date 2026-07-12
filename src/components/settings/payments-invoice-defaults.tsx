"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "off" | "on_completion" | "delayed";

// Owner-only firm-wide DEFAULT invoice automation (migration 0590). Pre-selects
// the choice on every new engagement. Optimistic save + revert, same pattern as
// the other firm-settings toggles (a plain POST, the client owns the state).
export function PaymentsInvoiceDefaults({
  initialMode,
  initialDelayDays,
}: {
  initialMode: Mode;
  initialDelayDays: number | null;
}) {
  const t = useTranslations("Settings");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [delayDays, setDelayDays] = useState<string>(
    initialDelayDays != null ? String(initialDelayDays) : "7",
  );
  const [error, setError] = useState<string | null>(null);

  async function save(nextMode: Mode, nextDelay: string) {
    setError(null);
    const delayNum = Math.max(1, Math.floor(Number(nextDelay) || 0));
    try {
      const res = await fetch("/api/firm/invoice-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: nextMode,
          delayDays: nextMode === "delayed" ? delayNum : null,
        }),
      });
      if (!res.ok) setError(t("save_failed"));
    } catch (e) {
      console.error("[invoice-defaults] save failed:", e);
      setError(t("save_failed"));
    }
  }

  function onModeChange(next: Mode) {
    setMode(next);
    void save(next, delayDays);
  }
  function onDelayChange(next: string) {
    setDelayDays(next);
    if (mode === "delayed") void save("delayed", next);
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("invoice_defaults_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("invoice_defaults_hint")}
      </p>
      <div className="mt-4 max-w-md space-y-3">
        <Select value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{t("invoice_default_off")}</SelectItem>
            <SelectItem value="on_completion">
              {t("invoice_default_on_completion")}
            </SelectItem>
            <SelectItem value="delayed">
              {t("invoice_default_delayed")}
            </SelectItem>
          </SelectContent>
        </Select>
        {mode === "delayed" && (
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="invoice-default-delay" className="text-muted-foreground">
              {t("invoice_default_delay_label")}
            </Label>
            <Input
              id="invoice-default-delay"
              type="number"
              min={1}
              max={365}
              value={delayDays}
              onChange={(e) => onDelayChange(e.target.value)}
              className="w-20"
            />
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}
