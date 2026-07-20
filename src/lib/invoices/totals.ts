// Invoice line-item + tax computation — the ONE place invoice money math
// lives. Pure and dependency-light (imports only the tax engine) so the
// builder UI's live preview and the server actions run the IDENTICAL code:
// what the accountant sees in the modal is what the row stores and what the
// rails charge, to the cent, by construction.
//
// Rounding rules (locked in Phase 0):
//   * line amount   = round(quantity × unit_cents)            → integer cents
//   * each tax line = round(subtotal × rate) on the SUBTOTAL  → integer cents
//   * total         = subtotal + sum(tax lines)               → what's charged

import {
  PROVINCE_TAXES,
  taxAmountCents,
  type ProvinceCode,
  type RegistrationKind,
  type TaxComponentId,
} from "@/lib/tax/canada";

export const MAX_LINE_ITEMS = 40;
export const MAX_LINE_DESCRIPTION = 300;
// Stripe floor/ceiling for the charged TOTAL, mirrored from the create path.
export const MIN_TOTAL_CENTS = 50;
export const MAX_TOTAL_CENTS = 99_999_999;

export type InvoiceLineItem = {
  description: string;
  // Up to 3 decimals (hours, partial units). 0 < quantity <= 9999.
  quantity: number;
  unit_cents: number;
  // Frozen at compute time: round(quantity * unit_cents).
  amount_cents: number;
};

// A tax line EXACTLY as issued, frozen onto the row (a later settings /
// province / rate change never rewrites an issued invoice). Labels derive
// from component + rate at render (bilingual), so they are not stored.
export type FrozenTaxLine = {
  component: TaxComponentId;
  rate_milli_pct: number;
  registration_kind: RegistrationKind;
  base_cents: number;
  amount_cents: number;
  registration_number: string | null;
};

export type InvoiceComputation = {
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  taxLines: FrozenTaxLine[];
  taxTotalCents: number;
  totalCents: number;
};

export function computeLineAmountCents(
  quantity: number,
  unitCents: number,
): number {
  return Math.round(quantity * unitCents);
}

export type RawLineItem = {
  description: unknown;
  quantity: unknown;
  unit_cents: unknown;
};

// Validate + freeze client-supplied line items. Amounts are ALWAYS recomputed
// here — a client-supplied amount_cents is ignored, so a tampered payload can
// never make the charged total drift from the line math. Returns null when
// anything is out of bounds (the action reports invalid_lines).
export function normalizeLineItems(raw: unknown): InvoiceLineItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_LINE_ITEMS) {
    return null;
  }
  const out: InvoiceLineItem[] = [];
  for (const entry of raw as RawLineItem[]) {
    if (!entry || typeof entry !== "object") return null;
    // Description is OPTIONAL, mirroring the flat invoice it replaces (the
    // field has always been "Description (optional)"). Renderers show a
    // localized "Services" fallback for an empty one.
    const description =
      typeof entry.description === "string" ? entry.description.trim() : "";
    if (description.length > MAX_LINE_DESCRIPTION) {
      return null;
    }
    const quantity = Number(entry.quantity);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 9999 ||
      // Max 3 decimals — reject float noise beyond what the UI can enter.
      Math.round(quantity * 1000) !== quantity * 1000
    ) {
      return null;
    }
    const unitCents = Number(entry.unit_cents);
    if (
      !Number.isInteger(unitCents) ||
      unitCents < 0 ||
      unitCents > MAX_TOTAL_CENTS
    ) {
      return null;
    }
    out.push({
      description,
      quantity,
      unit_cents: unitCents,
      amount_cents: computeLineAmountCents(quantity, unitCents),
    });
  }
  return out;
}

export type ComputeInvoiceOptions = {
  // null = the firm hasn't set up invoicing: no tax machinery at all.
  province: ProvinceCode | null;
  // Master per-invoice taxes toggle.
  taxesEnabled: boolean;
  // Per-component toggles: the ids that are ON. null = all components on.
  enabledComponents: readonly TaxComponentId[] | null;
  // Frozen into the tax lines so the issued invoice keeps the numbers it was
  // issued with.
  registrationNumbers?: {
    gst?: string | null;
    qst?: string | null;
    pst?: string | null;
  };
};

export function computeInvoiceTotals(
  lineItems: InvoiceLineItem[],
  opts: ComputeInvoiceOptions,
): InvoiceComputation {
  const subtotalCents = lineItems.reduce((acc, l) => acc + l.amount_cents, 0);

  let taxLines: FrozenTaxLine[] = [];
  if (opts.province && opts.taxesEnabled) {
    const enabled = opts.enabledComponents;
    taxLines = PROVINCE_TAXES[opts.province]
      .filter((c) => (enabled ? enabled.includes(c.id) : true))
      .map((c) => ({
        component: c.id,
        rate_milli_pct: c.rateMilliPct,
        registration_kind: c.registrationKind,
        base_cents: subtotalCents,
        amount_cents: taxAmountCents(subtotalCents, c.rateMilliPct),
        registration_number:
          opts.registrationNumbers?.[c.registrationKind]?.trim() || null,
      }));
  }

  const taxTotalCents = taxLines.reduce((acc, l) => acc + l.amount_cents, 0);
  return {
    lineItems,
    subtotalCents,
    taxLines,
    taxTotalCents,
    totalCents: subtotalCents + taxTotalCents,
  };
}

// Parse a stored jsonb line_items / tax_breakdown value back into typed
// arrays. Defensive: a malformed row renders as "no lines" rather than
// crashing the page (matches the repo's fail-soft read convention).
export function parseStoredLineItems(v: unknown): InvoiceLineItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (l): l is InvoiceLineItem =>
      !!l &&
      typeof l === "object" &&
      typeof (l as InvoiceLineItem).description === "string" &&
      Number.isFinite((l as InvoiceLineItem).quantity) &&
      Number.isInteger((l as InvoiceLineItem).unit_cents) &&
      Number.isInteger((l as InvoiceLineItem).amount_cents),
  );
}

export function parseStoredTaxLines(v: unknown): FrozenTaxLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (l): l is FrozenTaxLine =>
      !!l &&
      typeof l === "object" &&
      typeof (l as FrozenTaxLine).component === "string" &&
      Number.isFinite((l as FrozenTaxLine).rate_milli_pct) &&
      Number.isInteger((l as FrozenTaxLine).base_cents) &&
      Number.isInteger((l as FrozenTaxLine).amount_cents),
  );
}
