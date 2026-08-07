"use client";

// Canopy's SERVICES TAB — billing blocks, and what the client is allowed to see.
//
// A block is a group of services sharing one billing rule: "$4,000 on
// acceptance" is one, "$500/month from the engagement start" is another, and a
// proposal can carry both. Canopy builds their Services tab from these; Vylan
// had a flat list of priced lines, each carrying its own frequency, which could
// say HOW OFTEN but never WHEN or on what terms.
//
// The services inside a block are edited by the SAME EngagementItemsEditor the
// engagement builder uses — same rounding, same catalogue picker, same totals.
// What this file adds is only the grouping and the rule.
//
// ── ONE THING DELIBERATELY HIDDEN ──────────────────────────────────────────
//
// Each item still has its own billing-frequency field (migration 1450), but
// inside a block the BLOCK decides — flattenBlocks overwrites it on the way
// out. Showing a per-item frequency here would offer a control whose answer is
// then thrown away, so the editor is told to hide it.

import { useTranslations } from "next-intl";
import { Plus, Trash2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  EngagementItemsEditor,
  type CatalogueService,
} from "@/components/engagements/engagement-items-editor";
import {
  BILLING_TYPES,
  BLOCK_FREQUENCIES,
  blockTotal,
  emptyBlock,
  timingsFor,
  withBillingType,
  type BillingBlock,
  type BlockFrequency,
  type BlockTiming,
  type PriceVisibility,
} from "@/lib/engagements/billing-blocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Spelled out so a typo is a compile error rather than a `Templates.x`
// rendering on screen — next-intl fails silently.
type TimingKey =
  | "timing_on_acceptance"
  | "timing_on_completion"
  | "timing_engagement_start"
  | "timing_custom_date";
type FrequencyKey =
  | "freq_weekly"
  | "freq_monthly"
  | "freq_quarterly"
  | "freq_yearly";
type BillingTypeKey = "billing_one_time" | "billing_recurring";

export function BillingBlocksEditor({
  blocks,
  onChange,
  visibility,
  onVisibilityChange,
  locale,
  services = [],
  fallbackTaxPct = null,
  onServicePicked,
  hideBillingType = false,
}: {
  blocks: BillingBlock[];
  onChange: (next: BillingBlock[]) => void;
  visibility: PriceVisibility;
  onVisibilityChange: (next: PriceVisibility) => void;
  locale: "en" | "fr";
  services?: CatalogueService[];
  fallbackTaxPct?: number | null;
  /** Fired when a picked service carries work (1620), so the caller can pull
   *  the tasks in. Passed straight through — a block has no opinion about it. */
  onServicePicked?: (service: CatalogueService) => void;
  /** The engagement builder's Automation step owns "how this repeats" now
   *  (founder: "there's now recurring still on service items, when you
   *  should just be able to do that from automation") — so it hides the
   *  One-time/Recurring pills and the per-block frequency here. The blocks
   *  still CARRY that state; one screen sets it. The template builders pass
   *  nothing and keep the full controls, since they have no Automation
   *  step to move the choice to. */
  hideBillingType?: boolean;
}) {
  const t = useTranslations("Templates");

  const money = (cents: number) =>
    new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(cents / 100);

  function patch(idx: number, next: BillingBlock) {
    onChange(blocks.map((b, i) => (i === idx ? next : b)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {/* No "BILLING" heading. The founder: "there's a billing and payment
            section inside, and then there's also a billing tagline where
            service items are" — two different things wearing one word, on one
            screen. The card this sits in already says what it is.

            This component is shared, so removing it here removes it from the
            engagement builder AND every template builder at once. */}
        <span />
        {/* Canopy's gear: what the client sees. A menu rather than three
            switches on the page — it is set once and then not thought about. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              <Settings2 className="size-3.5" />
              {t("price_visibility")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuCheckboxItem
              checked={visibility.itemizedPrice}
              onCheckedChange={(v) =>
                onVisibilityChange({ ...visibility, itemizedPrice: v === true })
              }
            >
              {t("show_itemized_price")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibility.blockTotals}
              onCheckedChange={(v) =>
                onVisibilityChange({ ...visibility, blockTotals: v === true })
              }
            >
              {t("show_block_totals")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={visibility.total}
              onCheckedChange={(v) =>
                onVisibilityChange({ ...visibility, total: v === true })
              }
            >
              {t("show_total")}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {blocks.length === 0 && (
        <p className="rounded-xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
          {t("billing_blocks_empty")}
        </p>
      )}

      {blocks.map((b, idx) => {
        const total = blockTotal(b, fallbackTaxPct);
        return (
          <section
            key={idx}
            // Border only, no raised fill: this already sits inside the step's
            // own card, and a card-on-card was one of the layers the founder
            // was counting.
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              {/* HOW it bills. Changing this resets a timing the new type has
                  no meaning for — see withBillingType. */}
              {!hideBillingType &&
                BILLING_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => patch(idx, withBillingType(b, type))}
                    aria-pressed={b.billingType === type}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      b.billingType === type
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(
                      (type === "one_time"
                        ? "billing_one_time"
                        : "billing_recurring") as BillingTypeKey,
                    )}
                  </button>
                ))}

              <span className="text-xs text-muted-foreground">
                {t("billing_when")}
              </span>
              <select
                value={b.timing}
                onChange={(e) =>
                  patch(idx, { ...b, timing: e.target.value as BlockTiming })
                }
                aria-label={t("billing_when")}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {timingsFor(b.billingType).map((timing) => (
                  <option key={timing} value={timing}>
                    {t(`timing_${timing}` as TimingKey)}
                  </option>
                ))}
              </select>

              {b.billingType === "recurring" && !hideBillingType && (
                <select
                  value={b.frequency}
                  onChange={(e) =>
                    patch(idx, {
                      ...b,
                      frequency: e.target.value as BlockFrequency,
                    })
                  }
                  aria-label={t("billing_frequency")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {BLOCK_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {t(`freq_${f}` as FrequencyKey)}
                    </option>
                  ))}
                </select>
              )}

              {/* ── ONLY ONE BIN IS EVER MEANINGFUL ────────────────────────
                  Founder: "why is there two delete/garbage bins when they do
                  the same thing."

                  With a single block they DID do the same thing. This one
                  removes the whole billing group; the one on each row removes
                  that service. When there is one group holding one service,
                  both leave you with nothing — two identical icons, forty
                  pixels apart, with different meanings you cannot see.

                  So the group bin appears only once there are groups to choose
                  between. With one group the row bins are the only controls,
                  and they are unambiguous. */}
              {blocks.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(blocks.filter((_, i) => i !== idx))}
                  aria-label={t("remove_block")}
                  title={t("remove_block")}
                  className="ml-auto text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>

            {/* The SAME priced-scope editor the engagement builder uses. The
                per-item frequency is hidden because the block decides it. */}
            <EngagementItemsEditor
              items={b.items}
              onChange={(items) => patch(idx, { ...b, items })}
              locale={locale}
              services={services}
              onServicePicked={onServicePicked}
              fallbackTaxPct={fallbackTaxPct}
              hideFrequency
            />

            {/* The checkbox, its note and the total used to share one flex
                row. In a narrow column — which is where engagement creation
                puts this — the note box was squeezed to nothing and its
                placeholder read as "A note for the client about this c".
                Rows now stack, and the note only appears once combining is on:
                it is the wording for the combined line, which is meaningless
                while the lines are shown separately. */}
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="flex items-start justify-between gap-4">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={b.combineItems}
                    onChange={(e) =>
                      patch(idx, { ...b, combineItems: e.target.checked })
                    }
                  />
                  <span>
                    {t("combine_items")}
                    {/* What it actually does, because "show as one line to the
                        client" told the founder nothing: "what does that even
                        mean?" */}
                    <span className="block text-[11px] leading-relaxed text-muted-foreground">
                      {t("combine_items_hint")}
                    </span>
                  </span>
                </label>
                {/* Only when there IS a total. A block with no priced lines
                    used to render a bare "$0.00" floating under the hint —
                    the founder: "service items is fully glitched look". */}
                {visibility.blockTotals && b.items.length > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {money(total.cents)}
                    {/* Said out loud. A total that quietly omits an unpriced
                        hourly line is a number a client will hold you to. */}
                    {total.partial && ` ${t("total_partial")}`}
                  </span>
                )}
              </div>
              {b.combineItems && (
                <Input
                  value={b.clientNote}
                  onChange={(e) =>
                    patch(idx, { ...b, clientNote: e.target.value })
                  }
                  placeholder={t("client_note_placeholder")}
                  aria-label={t("client_note_placeholder")}
                  className="h-8 w-full text-xs"
                />
              )}
            </div>
          </section>
        );
      })}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...blocks, emptyBlock("one_time")])}
        >
          <Plus className="size-3.5" />
          {t("add_billing_group")}
        </Button>
      </div>
    </div>
  );
}
