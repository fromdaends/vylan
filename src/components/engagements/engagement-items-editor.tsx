"use client";

// The engagement's SCOPE — the priced service lines.
//
// The founder's framing, comparing Vylan against Canopy: "an engagement is not
// purely defined by document requested checklist items. Its abundant amount of
// tasks and things to do." These lines are the spine of that wider engagement:
// the invoice is generated from them, and tasks will hang off them.
//
// This is NOT the document checklist and must never read like it. The checklist
// answers "what do I need FROM the client"; this answers "what am I DOING for
// them, and for how much". They were the same thing only because one of them
// had no table.
//
// All money is integer cents in and out. The input shows dollars because that is
// what an accountant types, and converts on the boundary — a float never reaches
// state, so a quarterly total cannot drift by a cent.

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BILLING_FREQUENCIES,
  RATE_TYPES,
  emptyItem,
  totalForItems,
  type BillingFrequency,
  type EngagementItemDraft,
  type RateType,
} from "@/lib/engagements/items";
import { formatCurrency, type AppLocale } from "@/lib/format";

/** One entry from the firm's catalogue, as this editor needs it. */
export type CatalogueService = {
  id: string;
  name: string;
  /**
   * The work this service implies (1620) — the task template it points at, with
   * enough of it to describe the offer without a second query.
   *
   * Null when the service carries no work, which is normal: plenty of services
   * are a price and nothing else.
   */
  work?: { templateId: string; name: string; kind: string; stepCount: number } | null;
  description: string | null;
  rateCents: number | null;
  rateType: RateType;
  billingFrequency: BillingFrequency;
  taxPct: number | null;
};

type FreqKey =
  | "item_freq_once"
  | "item_freq_weekly"
  | "item_freq_monthly"
  | "item_freq_quarterly"
  | "item_freq_yearly";
type RateKey = "item_rate_item" | "item_rate_hour";

export function EngagementItemsEditor({
  items,
  onChange,
  locale,
  /**
   * The firm's service catalogue (migration 1480). Picking one COPIES its
   * values onto the line — Canopy's model, and the founder's call: it suggests
   * the price, it does not lock it.
   */
  services = [],
  /** The firm's default tax rate, used where a line does not set its own. */
  fallbackTaxPct = null,
  /**
   * Called when a picked service carries WORK (1620), so the caller can pull
   * that task template's tasks in.
   *
   * A callback rather than this component doing it: tasks are not this
   * editor's business — it edits priced lines. The engagement builder owns the
   * task list and is the only thing that can add to it without two components
   * fighting over the same state.
   */
  onServicePicked,
  /**
   * Hide the per-item billing frequency.
   *
   * TRUE inside a BILLING BLOCK, where the block decides how often its services
   * bill and flattenBlocks overwrites whatever the item held. Showing the
   * control there would offer an answer that is then thrown away — worse than
   * not offering it, because the accountant would believe it.
   */
  hideFrequency = false,
}: {
  items: EngagementItemDraft[];
  onChange: (next: EngagementItemDraft[]) => void;
  locale: AppLocale;
  services?: CatalogueService[];
  fallbackTaxPct?: number | null;
  hideFrequency?: boolean;
  onServicePicked?: (service: CatalogueService) => void;
}) {
  const t = useTranslations("Engagements");
  const total = totalForItems(items, fallbackTaxPct);

  function patch(idx: number, next: Partial<EngagementItemDraft>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...next } : it)));
  }

  // Copy the catalogue entry onto the line. NOT a live link: the values land
  // here and belong to this engagement from now on, so editing the service
  // later cannot rewrite a proposal already sent.
  //
  // Anything the accountant already typed WINS. Somebody who entered a rate and
  // then picked the service meant the rate.
  function chooseService(idx: number, id: string) {
    const item = items[idx];
    if (id === "") return patch(idx, { serviceId: null });
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    patch(idx, {
      serviceId: svc.id,
      name: item.name.trim() === "" ? svc.name : item.name,
      description: item.description ?? svc.description,
      rateCents: item.rateCents ?? svc.rateCents,
      rateType: svc.rateType,
      // Frequency is the ENGAGEMENT's call, not the catalogue's — the same
      // service is monthly for one client and annual for another. The
      // catalogue's value is only a starting point.
      billingFrequency: svc.billingFrequency,
      taxPct: item.taxPct ?? svc.taxPct,
    });
    // The work comes with it, automatically — the founder's call: "there
    // should be no prompt. It should happen automatically when the tasks get
    // pulled in. just be able to edit the tasks afterwards."
    if (svc.work) onServicePicked?.(svc);
  }


  // Dollars in the box, cents in state. Empty stays NULL rather than becoming 0:
  // "we will tell you the rate later" is a real answer, and a proposal that says
  // $0.00 where it means that has promised the work for free.
  function setRate(idx: number, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") return patch(idx, { rateCents: null });
    const dollars = Number(trimmed.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars)) return;
    patch(idx, { rateCents: Math.round(dollars * 100) });
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t("items_empty")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => onChange([emptyItem()])}
          >
            <Plus className="size-4" aria-hidden />
            {t("items_add")}
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, idx) => (
            <li
              key={idx}
              className="rounded-lg border border-border/60 bg-background/40 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <Label htmlFor={`item-name-${idx}`} className="text-xs">
                      {t("item_name")}
                    </Label>
                    <Input
                      id={`item-name-${idx}`}
                      value={item.name}
                      onChange={(e) => patch(idx, { name: e.target.value })}
                      placeholder={t("item_name_placeholder")}
                      className="mt-1"
                    />
                  </div>


                  {services.length === 0 ? (
                    // An empty catalogue used to render NOTHING here, so the
                    // link looked like a missing feature rather than an empty
                    // cupboard. Say it, and say where to fill it.
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("item_service_empty")}{" "}
                      <Link
                        href="/templates/services/new"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {t("item_service_empty_link")}
                      </Link>
                    </p>
                  ) : (
                    <div>
                      <Label htmlFor={`item-service-${idx}`} className="text-xs">
                        {t("item_service")}
                      </Label>
                      <select
                        id={`item-service-${idx}`}
                        value={item.serviceId ?? ""}
                        onChange={(e) => chooseService(idx, e.target.value)}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* Blank first — a bespoke line belongs to no service,
                            which is the ordinary case for one-off work. */}
                        <option value="">{t("item_service_none")}</option>
                        {services.map((svc) => (
                          <option key={svc.id} value={svc.id}>
                            {svc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <Label htmlFor={`item-rate-${idx}`} className="text-xs">
                        {t("item_rate")}
                      </Label>
                      <Input
                        id={`item-rate-${idx}`}
                        inputMode="decimal"
                        value={
                          item.rateCents == null
                            ? ""
                            : (item.rateCents / 100).toFixed(2)
                        }
                        onChange={(e) => setRate(idx, e.target.value)}
                        placeholder={t("item_rate_placeholder")}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor={`item-ratetype-${idx}`} className="text-xs">
                        {t("item_rate_type")}
                      </Label>
                      <select
                        id={`item-ratetype-${idx}`}
                        value={item.rateType}
                        onChange={(e) =>
                          patch(idx, { rateType: e.target.value as RateType })
                        }
                        className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {RATE_TYPES.map((r) => (
                          <option key={r} value={r}>
                            {t(`item_rate_${r}` as RateKey)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={hideFrequency ? "hidden" : undefined}>
                      <Label htmlFor={`item-freq-${idx}`} className="text-xs">
                        {t("item_billing_frequency")}
                      </Label>
                      <select
                        id={`item-freq-${idx}`}
                        value={item.billingFrequency}
                        onChange={(e) =>
                          patch(idx, {
                            billingFrequency: e.target
                              .value as BillingFrequency,
                          })
                        }
                        className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {BILLING_FREQUENCIES.map((f) => (
                          <option key={f} value={f}>
                            {t(`item_freq_${f}` as FreqKey)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <Label htmlFor={`item-tax-${idx}`} className="text-xs">
                        {t("item_tax")}
                      </Label>
                      <Input
                        id={`item-tax-${idx}`}
                        inputMode="decimal"
                        value={item.taxPct == null ? "" : String(item.taxPct)}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          // Empty = "use the firm's default", which is a
                          // different statement from an explicit 0.
                          patch(idx, {
                            taxPct: v === "" ? null : Number(v) || 0,
                          });
                        }}
                        placeholder={
                          fallbackTaxPct == null ? "—" : String(fallbackTaxPct)
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor={`item-desc-${idx}`} className="text-xs">
                      {t("item_description")}
                    </Label>
                    <Textarea
                      id={`item-desc-${idx}`}
                      value={item.description ?? ""}
                      onChange={(e) =>
                        patch(idx, { description: e.target.value || null })
                      }
                      rows={2}
                      placeholder={t("item_description_placeholder")}
                      className="mt-1 text-sm"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, i) => i !== idx))}
                  aria-label={t("item_remove")}
                  title={t("item_remove")}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...items, emptyItem()])}
          >
            <Plus className="size-4" aria-hidden />
            {t("items_add")}
          </Button>

          <div className="text-right">
            <p className="text-sm">
              <span className="text-muted-foreground">{t("items_total")} </span>
              <span className="font-semibold tabular-nums">
                {formatCurrency(total.totalCents / 100, locale)}
              </span>
            </p>
            {/* Said out loud whenever a line could not be counted. A total that
                silently omits the hourly line reads as the whole price, and the
                client agrees to a number that was never the number. */}
            {total.partial && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("items_total_partial", { count: total.unstatableCount })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
