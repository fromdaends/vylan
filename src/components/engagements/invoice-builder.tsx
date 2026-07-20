"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import {
  PROVINCE_TAXES,
  taxComponentLabel,
  type ProvinceCode,
  type TaxComponentId,
} from "@/lib/tax/canada";
import {
  computeInvoiceTotals,
  computeLineAmountCents,
  parseStoredLineItems,
  MAX_LINE_ITEMS,
  MIN_TOTAL_CENTS,
  type InvoiceLineItem,
} from "@/lib/invoices/totals";
import { formatInvoiceNumber } from "@/lib/invoices/number";

// What the engagement page passes down so the builder can do its job without
// any client-side fetching: the firm's invoice settings (or null when the firm
// hasn't set up invoicing) and the Default-prices presets.
export type InvoiceBuilderSettings = {
  province: ProvinceCode;
  invoicePrefix: string;
  nextInvoiceSeq: number;
  defaultTerms: string | null;
  defaultNotes: string | null;
  defaultTaxesEnabled: boolean;
};

export type InvoiceBuilderPreset = {
  key: string;
  label: string;
  unitCents: number;
};

export type InvoiceBuilderConfig = {
  settings: InvoiceBuilderSettings | null;
  presets: InvoiceBuilderPreset[];
};

// The payload the dialog submits. Mirrors GeneratedInvoicePayload on the
// server; totals here are PREVIEW-only (the server recomputes from the same
// pure lib, so they agree to the cent).
export type InvoiceBuilderPayload = {
  lineItems: { description: string; quantity: number; unit_cents: number }[];
  taxesEnabled: boolean;
  enabledComponents: TaxComponentId[] | null;
  dueDate: string | null;
  terms: string | null;
  notes: string | null;
  totalCents: number;
  valid: boolean;
};

// Initial values when editing an existing generated invoice.
export type InvoiceBuilderInitial = {
  lineItems: unknown;
  taxBreakdown: unknown;
  taxesEnabled: boolean;
  dueDate: string | null;
  terms: string | null;
  notes: string | null;
};

type LineDraft = {
  id: number;
  description: string;
  quantity: string;
  rate: string;
};

// Module-level line-id counter: ids only need uniqueness within a session (they
// are React keys, never persisted), and a module counter keeps id generation
// out of render (React forbids reading refs there).
let nextLineId = 1;
function newLineId(): number {
  return nextLineId++;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// "1" stays "1", "2.5" stays "2.5" — no forced decimals on quantity.
function qtyToInput(q: number): string {
  return String(q);
}

function parseQty(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 9999) return NaN;
  // Max 3 decimals, mirroring the server rule.
  if (Math.round(n * 1000) !== n * 1000) return NaN;
  return n;
}

function parseRateCents(v: string): number {
  if (v.trim() === "") return NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

// The line-item invoice builder used by the Invoice dialog for BOTH create and
// edit. Fast path preserved by design: it opens as ONE description + one
// amount (exactly the two fields the modal always had — a quick T1 invoice is
// still typed in seconds); "Add line item" expands into the full
// qty × rate table. Everything below the lines is live: tax toggles, number
// preview, subtotal / tax / total — computed with the SAME pure lib the server
// uses, so the preview equals the charged amount to the cent.
export function InvoiceBuilder({
  config,
  initial,
  invoiceNumber,
  defaultAmount,
  locale,
  onChange,
}: {
  config: InvoiceBuilderConfig;
  // Present when editing an existing generated invoice; null when creating.
  initial: InvoiceBuilderInitial | null;
  // The frozen number when editing; null when creating (preview shows next).
  invoiceNumber: string | null;
  // Create mode: pre-fill the single line's amount (Default prices / last
  // amount), same string the flat dialog used.
  defaultAmount: string;
  locale: "fr" | "en";
  onChange: (payload: InvoiceBuilderPayload) => void;
}) {
  const t = useTranslations("Engagements");
  const settings = config.settings;

  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (initial) {
      const stored = parseStoredLineItems(initial.lineItems);
      if (stored.length > 0) {
        return stored.map((l) => ({
          id: newLineId(),
          description: l.description,
          quantity: qtyToInput(l.quantity),
          rate: centsToInput(l.unit_cents),
        }));
      }
    }
    return [
      {
        id: newLineId(),
        description: "",
        quantity: "1",
        rate: defaultAmount,
      },
    ];
  });
  // Fast path: a single qty-1 line renders as just description + amount. The
  // full table appears once there's more than one line (or any qty ≠ 1).
  const [expanded, setExpanded] = useState(() => {
    if (!initial) return false;
    const stored = parseStoredLineItems(initial.lineItems);
    return stored.length > 1 || stored.some((l) => l.quantity !== 1);
  });
  const [taxesOn, setTaxesOn] = useState(() =>
    initial ? initial.taxesEnabled : (settings?.defaultTaxesEnabled ?? false),
  );
  const [offComponents, setOffComponents] = useState<TaxComponentId[]>(() => {
    if (!initial || !settings) return [];
    // Reconstruct which components were toggled off from the stored breakdown.
    const stored = new Set(
      (Array.isArray(initial.taxBreakdown) ? initial.taxBreakdown : [])
        .map((l) => (l as { component?: string }).component)
        .filter(Boolean),
    );
    if (!initial.taxesEnabled) return [];
    return PROVINCE_TAXES[settings.province]
      .map((c) => c.id)
      .filter((id) => !stored.has(id));
  });
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [terms, setTerms] = useState(
    initial ? (initial.terms ?? "") : (settings?.defaultTerms ?? ""),
  );
  const [notes, setNotes] = useState(
    initial ? (initial.notes ?? "") : (settings?.defaultNotes ?? ""),
  );

  const components = useMemo(
    () => (settings ? PROVINCE_TAXES[settings.province] : []),
    [settings],
  );
  const enabledComponents = useMemo(
    () =>
      components.map((c) => c.id).filter((id) => !offComponents.includes(id)),
    [components, offComponents],
  );

  // Parse drafts → computable lines. A line is countable once description AND
  // rate are valid; untouched trailing blanks are ignored rather than invalid.
  const parsed = useMemo(() => {
    const items: InvoiceLineItem[] = [];
    let anyInvalid = false;
    for (const l of lines) {
      const blank =
        l.description.trim() === "" && l.rate.trim() === "";
      if (blank) continue;
      const qty = parseQty(l.quantity);
      const rate = parseRateCents(l.rate);
      if (
        l.description.trim() === "" ||
        l.description.trim().length > 300 ||
        Number.isNaN(qty) ||
        Number.isNaN(rate) ||
        rate > 99_999_999
      ) {
        anyInvalid = true;
        continue;
      }
      items.push({
        description: l.description.trim(),
        quantity: qty,
        unit_cents: rate,
        amount_cents: computeLineAmountCents(qty, rate),
      });
    }
    return { items, anyInvalid };
  }, [lines]);

  const computation = useMemo(
    () =>
      computeInvoiceTotals(parsed.items, {
        province: settings?.province ?? null,
        taxesEnabled: taxesOn,
        enabledComponents,
      }),
    [parsed.items, settings, taxesOn, enabledComponents],
  );

  const valid =
    !parsed.anyInvalid &&
    parsed.items.length > 0 &&
    computation.totalCents >= MIN_TOTAL_CENTS &&
    computation.totalCents <= 99_999_999;

  // Report every change upward; the dialog holds the latest payload for submit.
  // onChange is a useState setter in practice (stable identity), so it can sit
  // in the effect deps without causing loops.
  useEffect(() => {
    onChange({
      lineItems: parsed.items.map(({ description, quantity, unit_cents }) => ({
        description,
        quantity,
        unit_cents,
      })),
      taxesEnabled: taxesOn,
      enabledComponents:
        enabledComponents.length === components.length
          ? null
          : enabledComponents,
      dueDate: dueDate || null,
      terms: terms.trim() || null,
      notes: notes.trim() || null,
      totalCents: computation.totalCents,
      valid,
    });
  }, [
    parsed.items,
    taxesOn,
    enabledComponents,
    components.length,
    dueDate,
    terms,
    notes,
    computation.totalCents,
    valid,
    onChange,
  ]);

  function patchLine(id: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine(preset?: InvoiceBuilderPreset) {
    setLines((ls) => {
      if (ls.length >= MAX_LINE_ITEMS) return ls;
      // A preset fills the current single empty line before appending.
      if (preset) {
        const target = ls.find(
          (l) => l.description.trim() === "" && l.rate.trim() === "",
        );
        if (target) {
          return ls.map((l) =>
            l.id === target.id
              ? {
                  ...l,
                  description: preset.label,
                  quantity: "1",
                  rate: centsToInput(preset.unitCents),
                }
              : l,
          );
        }
      }
      return [
        ...ls,
        {
          id: newLineId(),
          description: preset?.label ?? "",
          quantity: "1",
          rate: preset ? centsToInput(preset.unitCents) : "",
        },
      ];
    });
    if (!preset) setExpanded(true);
  }

  function removeLine(id: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  }

  const single = !expanded && lines.length === 1;
  const nextNumber =
    invoiceNumber ??
    (settings
      ? formatInvoiceNumber(settings.invoicePrefix, settings.nextInvoiceSeq)
      : null);

  return (
    <div className="space-y-4">
      {/* ── Lines ── */}
      {single ? (
        // FAST PATH: the same two fields the modal always had.
        <>
          <div className="space-y-1.5">
            <Label htmlFor="inv-b-desc">{t("request_payment_description")}</Label>
            <Textarea
              id="inv-b-desc"
              value={lines[0].description}
              onChange={(e) => patchLine(lines[0].id, { description: e.target.value })}
              rows={2}
              maxLength={300}
              placeholder={t("request_payment_description_ph")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-b-amount">{t("request_payment_amount")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="inv-b-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={lines[0].rate}
                onChange={(e) => patchLine(lines[0].id, { rate: e.target.value })}
                className="pl-7"
                placeholder="0.00"
              />
            </div>
          </div>
        </>
      ) : (
        // FULL BUILDER: description · qty · rate · amount per line.
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_3.5rem_5rem_4.5rem_1.5rem] items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
            <span>{t("request_payment_description")}</span>
            <span className="text-right">{t("invoice_qty")}</span>
            <span className="text-right">{t("invoice_rate")}</span>
            <span className="text-right">{t("request_payment_amount")}</span>
            <span />
          </div>
          {lines.map((l) => {
            const qty = parseQty(l.quantity);
            const rate = parseRateCents(l.rate);
            const amount =
              !Number.isNaN(qty) && !Number.isNaN(rate)
                ? computeLineAmountCents(qty, rate)
                : null;
            return (
              <div
                key={l.id}
                className="grid grid-cols-[1fr_3.5rem_5rem_4.5rem_1.5rem] items-center gap-1.5"
              >
                <Input
                  value={l.description}
                  onChange={(e) => patchLine(l.id, { description: e.target.value })}
                  maxLength={300}
                  placeholder={t("request_payment_description_ph")}
                  aria-label={t("request_payment_description")}
                  className="h-9"
                />
                <Input
                  value={l.quantity}
                  onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  aria-label={t("invoice_qty")}
                  className="h-9 px-2 text-right"
                />
                <Input
                  value={l.rate}
                  onChange={(e) => patchLine(l.id, { rate: e.target.value })}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  aria-label={t("invoice_rate")}
                  className="h-9 px-2 text-right"
                />
                <span className="truncate text-right text-sm tabular-nums">
                  {amount != null ? formatCurrency(amount / 100, locale) : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(l.id)}
                  disabled={lines.length === 1}
                  aria-label={t("invoice_line_remove")}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => addLine()}
          disabled={lines.length >= MAX_LINE_ITEMS}
        >
          <Plus className="size-3.5" />
          {t("invoice_add_line")}
        </Button>
        {/* Default-prices presets: one tap inserts a prefilled line. */}
        {config.presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => addLine(p)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {p.label} · {formatCurrency(p.unitCents / 100, locale)}
          </button>
        ))}
      </div>

      {/* ── Taxes ── */}
      {settings ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("invoice_charge_taxes")}</span>
            <Switch
              checked={taxesOn}
              onCheckedChange={setTaxesOn}
              aria-label={t("invoice_charge_taxes")}
            />
          </div>
          {taxesOn && components.length > 1 && (
            <div className="flex flex-wrap gap-3 pt-1">
              {components.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={!offComponents.includes(c.id)}
                    onChange={(e) =>
                      setOffComponents((prev) =>
                        e.target.checked
                          ? prev.filter((id) => id !== c.id)
                          : [...prev, c.id],
                      )
                    }
                  />
                  {taxComponentLabel(c, locale)}
                </label>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t("invoice_no_settings_note")}
        </p>
      )}

      {/* ── Document fields ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="inv-b-due">{t("invoice_due_date")}</Label>
          <Input
            id="inv-b-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-b-terms">{t("invoice_terms_label")}</Label>
          <Input
            id="inv-b-terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            maxLength={300}
            className="h-9"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-b-notes">{t("invoice_notes_label")}</Label>
        <Input
          id="inv-b-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
        />
      </div>

      {/* ── Live summary ── */}
      <div className="space-y-1 rounded-lg bg-secondary/50 p-3 text-sm">
        {nextNumber && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("invoice_number_label")}</span>
            <span className="font-medium tabular-nums">{nextNumber}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("invoice_subtotal")}</span>
          <span className="tabular-nums">
            {formatCurrency(computation.subtotalCents / 100, locale)}
          </span>
        </div>
        {computation.taxLines.map((line) => (
          <div
            key={line.component}
            className="flex items-center justify-between"
          >
            <span className="text-muted-foreground">
              {taxComponentLabel(
                { id: line.component, rateMilliPct: line.rate_milli_pct },
                locale,
              )}
            </span>
            <span className="tabular-nums">
              {formatCurrency(line.amount_cents / 100, locale)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border/60 pt-1 font-medium">
          <span>{t("invoice_total")}</span>
          <span className="tabular-nums">
            {formatCurrency(computation.totalCents / 100, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}
