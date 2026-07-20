"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROVINCE_CODES,
  PROVINCE_TAXES,
  provinceName,
  taxComponentLabel,
  type ProvinceCode,
} from "@/lib/tax/canada";
import { formatInvoiceNumber } from "@/lib/invoices/number";
import type { FirmInvoiceSettings } from "@/lib/db/invoice-settings";

// Owner-only "Invoicing" section in Settings > Payments — the one-time setup
// behind generated invoices: business address + contact, province (drives the
// tax components), registration numbers, numbering, and defaults. Firm name,
// logo, and brand color are REUSED from Settings > Account, never duplicated
// here (the note below points there instead).
export function PaymentsInvoicingSection({
  settings,
}: {
  settings: FirmInvoiceSettings | null;
}) {
  const t = useTranslations("Settings");
  const locale = useLocale() === "fr" ? ("fr" as const) : ("en" as const);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [address, setAddress] = useState(settings?.address ?? "");
  const [contactLine, setContactLine] = useState(settings?.contact_line ?? "");
  const [province, setProvince] = useState<ProvinceCode>(
    settings?.province ?? "QC",
  );
  const [gstNumber, setGstNumber] = useState(settings?.gst_number ?? "");
  const [qstNumber, setQstNumber] = useState(settings?.qst_number ?? "");
  const [pstNumber, setPstNumber] = useState(settings?.pst_number ?? "");
  const [prefix, setPrefix] = useState(settings?.invoice_prefix ?? "INV-");
  const [nextSeq, setNextSeq] = useState(
    String(settings?.next_invoice_seq ?? 1),
  );
  const [terms, setTerms] = useState(settings?.default_terms ?? "");
  const [notes, setNotes] = useState(settings?.default_notes ?? "");
  const [taxesOn, setTaxesOn] = useState(
    settings?.default_taxes_enabled ?? true,
  );

  // Provinces sorted by their localized display name.
  const provinceOptions = useMemo(
    () =>
      [...PROVINCE_CODES].sort((a, b) =>
        provinceName(a, locale).localeCompare(provinceName(b, locale), locale),
      ),
    [locale],
  );

  // Which registration-number fields this province uses, and the summary line
  // of its tax components ("TPS (5 %) + TVQ (9,975 %)").
  const components = PROVINCE_TAXES[province];
  const registrationKinds = new Set(components.map((c) => c.registrationKind));
  const taxSummary = components
    .map((c) => taxComponentLabel(c, locale))
    .join(" + ");
  const pstLabel =
    province === "MB" ? t("invoicing_rst_label") : t("invoicing_pst_label");

  const seqForPreview = Math.max(1, Math.floor(Number(nextSeq) || 1));
  const nextNumberPreview = formatInvoiceNumber(prefix, seqForPreview);

  function save() {
    setError(null);
    const seq = Math.floor(Number(nextSeq));
    if (!Number.isFinite(seq) || seq < 1) {
      setError(t("invoicing_next_invalid"));
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/firm/invoicing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: address.trim() || null,
            contactLine: contactLine.trim() || null,
            province,
            gstNumber: gstNumber.trim() || null,
            qstNumber: qstNumber.trim() || null,
            pstNumber: pstNumber.trim() || null,
            invoicePrefix: prefix.trim(),
            nextInvoiceSeq: seq,
            defaultTerms: terms.trim() || null,
            defaultNotes: notes.trim() || null,
            defaultTaxesEnabled: taxesOn,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(
            data?.error === "migration_pending"
              ? t("invoicing_migration_pending")
              : t("invoicing_error"),
          );
          return;
        }
        toast.success(t("invoicing_saved"));
      } catch {
        setError(t("invoicing_error"));
      }
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">{t("invoicing_title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("invoicing_hint")}</p>

      <div className="mt-4 max-w-xl space-y-5 rounded-lg border border-border/50 p-4">
        {/* Identity comes from Account settings — reused, never duplicated. */}
        <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          {t("invoicing_identity_note")}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="invoicing-address">
            {t("invoicing_address_label")}
          </Label>
          <Textarea
            id="invoicing-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t("invoicing_address_ph")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invoicing-contact">
            {t("invoicing_contact_label")}
          </Label>
          <Input
            id="invoicing-contact"
            value={contactLine}
            onChange={(e) => setContactLine(e.target.value)}
            maxLength={200}
            placeholder={t("invoicing_contact_ph")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invoicing-province">
            {t("invoicing_province_label")}
          </Label>
          <Select
            value={province}
            onValueChange={(v) => setProvince(v as ProvinceCode)}
          >
            <SelectTrigger id="invoicing-province">
              {/* Children (not the registry) drive the closed-state text so the
                  current province shows before the content has ever mounted. */}
              <SelectValue>{provinceName(province, locale)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {provinceOptions.map((code) => (
                <SelectItem key={code} value={code}>
                  {provinceName(code, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("invoicing_province_taxes", { taxes: taxSummary })}
          </p>
        </div>

        {/* Registration numbers — only the fields this province uses. */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invoicing-gst">{t("invoicing_gst_label")}</Label>
            <Input
              id="invoicing-gst"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              maxLength={50}
              placeholder="123456789 RT0001"
            />
          </div>
          {registrationKinds.has("qst") && (
            <div className="space-y-1.5">
              <Label htmlFor="invoicing-qst">{t("invoicing_qst_label")}</Label>
              <Input
                id="invoicing-qst"
                value={qstNumber}
                onChange={(e) => setQstNumber(e.target.value)}
                maxLength={50}
                placeholder="1234567890 TQ0001"
              />
            </div>
          )}
          {registrationKinds.has("pst") && (
            <div className="space-y-1.5">
              <Label htmlFor="invoicing-pst">{pstLabel}</Label>
              <Input
                id="invoicing-pst"
                value={pstNumber}
                onChange={(e) => setPstNumber(e.target.value)}
                maxLength={50}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t("invoicing_tax_numbers_hint")}
          </p>
        </div>

        {/* Numbering: prefix + next number, with a live preview. */}
        <div className="space-y-1.5">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoicing-prefix">
                {t("invoicing_prefix_label")}
              </Label>
              <Input
                id="invoicing-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                maxLength={12}
                className="w-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoicing-next">{t("invoicing_next_label")}</Label>
              <Input
                id="invoicing-next"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={nextSeq}
                onChange={(e) => setNextSeq(e.target.value)}
                className="w-32"
              />
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              {t("invoicing_next_preview", { number: nextNumberPreview })}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("invoicing_numbering_hint")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invoicing-terms">{t("invoicing_terms_label")}</Label>
          <Input
            id="invoicing-terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            maxLength={300}
            placeholder={t("invoicing_terms_ph")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invoicing-notes">{t("invoicing_notes_label")}</Label>
          <Input
            id="invoicing-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder={t("invoicing_notes_ph")}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm">{t("invoicing_taxes_default_label")}</div>
            <p className="text-xs text-muted-foreground">
              {t("invoicing_taxes_default_hint")}
            </p>
          </div>
          <Switch
            checked={taxesOn}
            onCheckedChange={setTaxesOn}
            aria-label={t("invoicing_taxes_default_label")}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "…" : t("invoicing_save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
