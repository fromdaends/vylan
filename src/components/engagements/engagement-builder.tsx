"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Sparkles, Receipt } from "lucide-react";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { createEngagementAction } from "@/app/actions/engagements";
import type { Template, TemplateItem, DocType } from "@/lib/db/templates";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import { SelectableTemplateCard } from "@/components/templates/template-card";
import { templateItemApplies } from "@/lib/doc-types";
import { resolveInitialTemplate } from "@/lib/engagements/initial-template";
import { resolveInvoiceAmountCents } from "@/lib/invoices/resolve";
import {
  localizedTemplateName,
  BLANK_TEMPLATE_SEED_ID,
} from "@/lib/templates/builtin-names";

type KnownErrorKey =
  | "missing_client"
  | "missing_template"
  | "missing_title"
  | "create_failed"
  | "min_2_chars"
  | "too_long"
  | "no_documents"
  | "invoice_amount_required";
const KNOWN_ERRORS = new Set<string>([
  "missing_client",
  "missing_template",
  "missing_title",
  "create_failed",
  "min_2_chars",
  "too_long",
  "no_documents",
  "invoice_amount_required",
]);

export type InvoiceAutoMode = "off" | "on_completion" | "delayed";

export function EngagementBuilder({
  clients,
  templates,
  initialClientId,
  initialTemplateId,
  locale,
  includeQuebecForms = true,
  servicePrices = {},
  connectReady = false,
  invoiceDefaultMode = "off",
  invoiceDefaultDelayDays = null,
}: {
  clients: ComboboxClient[];
  templates: Template[];
  initialClientId?: string;
  // The template the user clicked "Use" on, carried via ?template=. When it
  // matches a template the form opens on it; otherwise (direct open, or a
  // stale/unknown id) it falls back to the first template.
  initialTemplateId?: string;
  locale: "fr" | "en";
  // Firm-wide setting (migration 0350). When false, the Quebec-only RL slips
  // never appear in this firm's checklists, whatever the client's province.
  includeQuebecForms?: boolean;
  // Per-service default prices in cents (firms.service_prices), keyed by
  // engagement type — pre-fills the invoice amount.
  servicePrices?: Record<string, number>;
  // Whether the firm can receive payments (Stripe Connect charges enabled).
  // Invoice automation is only offered when true.
  connectReady?: boolean;
  // Firm-wide default invoice automation (migration 0590) — pre-selects here.
  invoiceDefaultMode?: InvoiceAutoMode;
  invoiceDefaultDelayDays?: number | null;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");

  // The blank "Empty" template leads the list and is the default when the user
  // didn't arrive via a specific template ("Use" on a card). Everything else
  // keeps its incoming order.
  const orderedTemplates = useMemo(() => {
    const blank = templates.find((tt) => tt.id === BLANK_TEMPLATE_SEED_ID);
    if (!blank) return templates;
    return [blank, ...templates.filter((tt) => tt.id !== BLANK_TEMPLATE_SEED_ID)];
  }, [templates]);

  // Open on the template the user picked via "Use" (matched by id); fall back to
  // the first template (now "Empty") for a direct open or a stale/unknown id.
  const initialTemplate = resolveInitialTemplate(
    orderedTemplates,
    initialTemplateId,
  );

  const [clientId, setClientId] = useState<string | null>(
    initialClientId ?? null,
  );
  const [templateId, setTemplateId] = useState<string>(
    initialTemplate?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [dueDate, setDueDate] = useState("");
  // "AI Analyze" toggle — on by default. When off, no document the client
  // uploads to this engagement is sent to the AI (saves AI usage/cost).
  const [aiEnabled, setAiEnabled] = useState(true);
  // Invoice automation (migration 0590). Pre-selected from the firm default.
  // Only meaningful when Connect is ready; forced off otherwise.
  const [invoiceMode, setInvoiceMode] = useState<InvoiceAutoMode>(
    connectReady ? invoiceDefaultMode : "off",
  );
  const [invoiceDelayDays, setInvoiceDelayDays] = useState<string>(
    invoiceDefaultDelayDays != null ? String(invoiceDefaultDelayDays) : "7",
  );
  // Amount source: use the firm's saved service price, or a custom amount.
  const [invoiceUseDefault, setInvoiceUseDefault] = useState(true);
  const [invoiceCustomAmount, setInvoiceCustomAmount] = useState<string>("");
  const [items, setItems] = useState<TemplateItem[]>(() => {
    // If we already know the client (e.g. started from a client's page), seed
    // the checklist with only the documents that apply to their province.
    const initialProvince =
      clients.find((c) => c.id === initialClientId)?.province ?? null;
    return (initialTemplate?.items ?? []).filter((it) =>
      templateItemApplies(it, initialProvince, includeQuebecForms),
    );
  });
  const [error, setError] = useState<string | null>(null);
  // How many times "Create and send" was pressed with an empty checklist.
  // From the 2nd attempt we ring the checklist so the reason is obvious.
  const [emptyAttempts, setEmptyAttempts] = useState(0);
  const [pending, startTransition] = useTransition();

  const selectedTemplate = templates.find((tt) => tt.id === templateId);
  // The chosen client's province drives which document types apply. Quebec
  // clients get the RL slips; everyone else (or province not set) doesn't.
  const selectedProvince =
    clients.find((c) => c.id === clientId)?.province ?? null;

  // The firm's saved default price (cents) for this engagement type — pre-fills
  // the invoice amount. Null if no default set for the type.
  const invoiceDefaultCents = selectedTemplate
    ? (servicePrices[selectedTemplate.type] ?? null)
    : null;
  // The amount to bill from the current invoice choices (shared pure helper).
  function currentInvoiceAmountCents(): number | null {
    return resolveInvoiceAmountCents({
      mode: invoiceMode,
      useDefault: invoiceUseDefault,
      defaultCents: invoiceDefaultCents,
      customAmount: invoiceCustomAmount,
    });
  }

  // Keep only the document types that apply to the given province (drops the
  // Quebec RL slips for a non-Quebec client). Empty-doc_type rows the
  // accountant is still typing are always kept.
  function forProvince(list: TemplateItem[], province: string | null) {
    return list.filter((it) =>
      templateItemApplies(it, province, includeQuebecForms),
    );
  }

  // Switching client re-filters the current checklist (e.g. picking an Ontario
  // client after a Quebec template drops the RL slips on the spot).
  function chooseClient(id: string | null) {
    setClientId(id);
    const province = clients.find((c) => c.id === id)?.province ?? null;
    setItems((prev) => forProvince(prev, province));
  }

  // Auto-fill title from template + year when not yet edited.
  const defaultTitle = useMemo(() => {
    if (!selectedTemplate) return "";
    const year = new Date().getFullYear();
    return `${localizedTemplateName(selectedTemplate, locale)} — ${year}`;
  }, [selectedTemplate, locale]);
  const effectiveTitle = titleTouched ? title : defaultTitle;

  // After a 2nd failed "Create and send" on an empty checklist, ring the
  // checklist section. The top-of-form error is easy to miss when the Send
  // button sits at the bottom, right next to this section.
  const highlightEmptyChecklist = items.length === 0 && emptyAttempts >= 2;

  function pickTemplate(id: string) {
    setTemplateId(id);
    const tmpl = templates.find((tt) => tt.id === id);
    // Apply the template, but only the documents that apply to this client's
    // province — an Ontario client never gets the Quebec RL slips.
    setItems(forProvince(tmpl?.items ?? [], selectedProvince));
    setTitleTouched(false);
  }

  function updateItem(idx: number, patch: Partial<TemplateItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        label_fr: "",
        label_en: "",
        description_fr: null,
        description_en: null,
        doc_type: "other" as DocType,
        required: false,
      },
    ]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveItem(idx: number, delta: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function submit(send: boolean) {
    setError(null);
    if (!clientId) {
      setError("missing_client");
      return;
    }
    if (!selectedTemplate) {
      setError("missing_template");
      return;
    }
    if (!effectiveTitle.trim() || effectiveTitle.length < 2) {
      setError("missing_title");
      return;
    }
    const cleanItems = items
      .map((i) => ({
        ...i,
        label_fr: i.label_fr.trim(),
        label_en: i.label_en.trim() || i.label_fr.trim(),
      }))
      .filter((i) => i.label_fr.length > 0);

    // Sending needs at least one document for the client to upload. Saving a
    // draft with an empty checklist is still allowed.
    if (send && cleanItems.length === 0) {
      setError("no_documents");
      setEmptyAttempts((n) => n + 1);
      return;
    }

    // Invoice automation needs a valid amount up front (nobody's there to type
    // one when it auto-sends). Guard client-side to match the server refine.
    const invoiceAmountCents = currentInvoiceAmountCents();
    if (invoiceMode !== "off" && invoiceAmountCents == null) {
      setError("invoice_amount_required");
      return;
    }
    const invoiceDelay =
      invoiceMode === "delayed"
        ? Math.max(1, Math.floor(Number(invoiceDelayDays) || 0))
        : null;

    startTransition(async () => {
      try {
        const result = await createEngagementAction({
          client_id: clientId,
          title: effectiveTitle.trim(),
          type: selectedTemplate.type,
          due_date: dueDate || null,
          ai_enabled: aiEnabled,
          invoice_auto_mode: invoiceMode,
          invoice_delay_days: invoiceDelay,
          invoice_amount_cents: invoiceAmountCents,
          items: cleanItems,
          send,
          locale,
        });
        // If the action redirected, this code never runs.
        if (result?.error) {
          setError(result.error);
        } else if (result?.fieldErrors) {
          const first = Object.entries(result.fieldErrors)[0];
          setError(first ? `${first[0]}: ${first[1]}` : "create_failed");
        }
      } catch (e) {
        const digest = (e as { digest?: string })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw e;
        }
        console.error("createEngagement threw:", e);
        setError("create_failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {/* Known i18n keys translate; everything else (e.g. server-side
                field errors like "client_id: invalid_uuid") shows raw. */}
            {KNOWN_ERRORS.has(error)
              ? t(`errors.${error}` as KnownErrorKey)
              : error}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_client")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* chooseClient re-filters the checklist for the new client's province */}
          <ClientCombobox
            clients={clients}
            value={clientId}
            onChange={chooseClient}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_template")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label={t("section_template")}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {orderedTemplates.map((tmpl) => (
              <SelectableTemplateCard
                key={tmpl.id}
                groupName="template"
                selected={templateId === tmpl.id}
                onSelect={() => pickTemplate(tmpl.id)}
                name={localizedTemplateName(tmpl, locale)}
                type={tmpl.type}
                itemCount={tmpl.items.length}
                requiredCount={tmpl.items.filter((it) => it.required).length}
                preview={tmpl.items
                  .slice(0, 3)
                  .map((it) =>
                    locale === "fr"
                      ? it.label_fr || it.label_en
                      : it.label_en || it.label_fr,
                  )}
                builtin={tmpl.firm_id == null}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section_details")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">{t("field_title")}</Label>
            <Input
              id="title"
              value={effectiveTitle}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder={defaultTitle}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due_date">{t("field_due_date_optional")}</Label>
            <Input
              id="due_date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-fit"
            />
            <p className="text-xs text-muted-foreground">
              {t("due_date_hint")}
            </p>
          </div>
          {/* "AI Analyze" toggle. On by default; turning it off means no
              document uploaded to this engagement is ever sent to the AI —
              helps the firm control AI usage on engagements that don't need it. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label
                htmlFor="ai-analyze"
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                {t("ai_analyze_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("ai_analyze_hint")}
              </p>
            </div>
            <Switch
              id="ai-analyze"
              checked={aiEnabled}
              onCheckedChange={setAiEnabled}
              ariaLabel={t("ai_analyze_label")}
            />
          </div>

          {/* Invoice automation (migration 0590). Only offered when the firm can
              actually receive a payment (Stripe Connect charges enabled). */}
          {connectReady ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-1.5">
                  <Receipt
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  {t("invoice_auto_label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("invoice_auto_hint")}
                </p>
              </div>
              <Select
                value={invoiceMode}
                onValueChange={(v) => setInvoiceMode(v as InvoiceAutoMode)}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t("invoice_mode_off")}</SelectItem>
                  <SelectItem value="on_completion">
                    {t("invoice_mode_on_completion")}
                  </SelectItem>
                  <SelectItem value="delayed">
                    {t("invoice_mode_delayed")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {invoiceMode === "delayed" && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("invoice_delay_prefix")}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={invoiceDelayDays}
                    onChange={(e) => setInvoiceDelayDays(e.target.value)}
                    className="w-20"
                    aria-label={t("invoice_delay_label")}
                  />
                  <span className="text-muted-foreground">
                    {t("invoice_delay_suffix")}
                  </span>
                </div>
              )}

              {invoiceMode !== "off" && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("invoice_amount_label")}
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="invoice-amount-source"
                        checked={
                          invoiceUseDefault && invoiceDefaultCents != null
                        }
                        onChange={() => setInvoiceUseDefault(true)}
                        disabled={invoiceDefaultCents == null}
                      />
                      {invoiceDefaultCents != null
                        ? t("invoice_use_default", {
                            amount: (invoiceDefaultCents / 100).toFixed(2),
                          })
                        : t("invoice_no_default")}
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="invoice-amount-source"
                        checked={
                          !invoiceUseDefault || invoiceDefaultCents == null
                        }
                        onChange={() => setInvoiceUseDefault(false)}
                      />
                      {t("invoice_custom")}
                    </label>
                  </div>
                  {(!invoiceUseDefault || invoiceDefaultCents == null) && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        type="number"
                        min={0.5}
                        step={0.01}
                        value={invoiceCustomAmount}
                        onChange={(e) => setInvoiceCustomAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-32"
                        aria-label={t("invoice_amount_label")}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t("invoice_auto_needs_connect")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card
        className={
          highlightEmptyChecklist
            ? "ring-2 ring-destructive transition-shadow"
            : "transition-shadow"
        }
      >
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {t("section_checklist")}{" "}
            <span className="text-muted-foreground font-normal">
              ({items.length})
            </span>
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="size-4" />
            {t("add_item")}
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div
              className={
                "text-sm text-center py-8 " +
                (highlightEmptyChecklist
                  ? "text-destructive font-medium"
                  : "text-muted-foreground")
              }
            >
              {t("checklist_empty")}
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col items-center pt-1 text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="hover:text-foreground disabled:opacity-30"
                        aria-label={t("move_up")}
                      >
                        ↑
                      </button>
                      <GripVertical className="size-3" aria-hidden />
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="hover:text-foreground disabled:opacity-30"
                        aria-label={t("move_down")}
                      >
                        ↓
                      </button>
                    </div>
                    <div className="flex-1 space-y-2">
                      {/* One label for the whole site. We mirror it into both
                          label_fr + label_en so the stored data + the client
                          portal stay consistent in either language. */}
                      <Input
                        value={item.label_en || item.label_fr}
                        onChange={(e) =>
                          updateItem(idx, {
                            label_fr: e.target.value,
                            label_en: e.target.value,
                          })
                        }
                        placeholder={t("label_placeholder")}
                        aria-label={t("label_placeholder")}
                      />
                      <Textarea
                        value={item.description_fr ?? ""}
                        onChange={(e) =>
                          updateItem(idx, {
                            description_fr: e.target.value || null,
                          })
                        }
                        placeholder={t("description_fr_placeholder")}
                        rows={1}
                        className="text-xs"
                      />
                      <div className="flex items-center gap-3 text-xs">
                        <DocTypePicker
                          value={item.doc_type}
                          onChange={(dt) => updateItem(idx, { doc_type: dt })}
                          className="h-8 w-[14rem] max-w-full text-xs"
                          province={selectedProvince}
                          includeQuebecForms={includeQuebecForms}
                        />
                        <label className="flex items-center gap-1.5 select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.required}
                            onChange={(e) =>
                              updateItem(idx, { required: e.target.checked })
                            }
                          />
                          {t("required")}
                        </label>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="ml-auto text-destructive hover:underline inline-flex items-center gap-1"
                        >
                          <Trash2 className="size-3" />
                          {tc("delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => submit(false)}
          disabled={pending}
        >
          {pending ? tc("saving") : t("save_draft")}
        </Button>
        <Button
          type="button"
          onClick={() => submit(true)}
          disabled={pending}
        >
          {pending ? tc("saving") : t("create_and_send")}
        </Button>
      </div>
    </div>
  );
}
