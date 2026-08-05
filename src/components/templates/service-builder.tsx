"use client";

// Create / edit a service — the SAME builder chrome as everything else.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// The founder: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES SHOULD ALL BE
// THE SAME. STOP BUILDING INCONSISTENT THINGS."
//
// A service was authored in a modal dialog — a third room for the same act,
// after the engagement template's full screen and the task template's unfolding
// card. It is a full screen now, on TemplateBuilderShell, with tabs and a live
// preview like the others.
//
// ── WHY THE WORK GETS ITS OWN TAB ──────────────────────────────────────────
//
// In the dialog, the service → task link was a bordered block wedged between
// the tax field and the description, which is the least important-looking place
// on the form. It is not a minor field. The founder: "the service is pretty
// much the action that's being done… And then within that action are a bunch of
// sub actions… I just wanna make sure that when you build a service template
// that it's not separated from the task template because that's confusing."
//
// So it is a tab, named for what it is, sitting beside the price. Selling the
// work and doing the work are the two halves of a service.
//
// Two ways in, one outcome: pick a task template you already have, or type the
// steps and Vylan makes one. Either way it is a REAL task template that shows
// on the Task templates page and any other service can reuse.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CornerDownRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TemplateBuilderShell,
  Field,
  Fieldset,
} from "@/components/templates/template-builder-shell";
import {
  createFirmServiceAction,
  updateFirmServiceAction,
} from "@/app/actions/firm-services";
import {
  BILLING_FREQUENCIES,
  RATE_TYPES,
  type BillingFrequency,
  type RateType,
} from "@/lib/engagements/items";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

const TABS = ["service", "pricing", "work"] as const;
type Tab = (typeof TABS)[number];

// Spelled out so a typo is a compile error rather than a `Templates.tab_x`
// rendering on screen — next-intl fails silently.
type TabKey = "tab_service_service" | "tab_service_pricing" | "tab_service_work";
type FreqKey =
  | "item_freq_once"
  | "item_freq_weekly"
  | "item_freq_monthly"
  | "item_freq_quarterly"
  | "item_freq_yearly";
type RateKey = "item_rate_item" | "item_rate_hour";

export type ServiceTaskTemplateOption = {
  id: string;
  name: string;
  steps: string[];
};

export function ServiceBuilder({
  locale,
  taskTemplates = [],
  initial,
}: {
  locale: AppLocale;
  /** The firm's task templates (1570), so a service can name the work it
   *  implies. Empty hides the picker and leaves only "type the steps". */
  taskTemplates?: ServiceTaskTemplateOption[];
  /** Present when editing. Absent when creating. */
  initial?: {
    id: string;
    name: string;
    description: string | null;
    rateCents: number | null;
    rateType: RateType;
    billingFrequency: BillingFrequency;
    taxPct: number | null;
    taskTemplateId: string | null;
  };
}) {
  // Field labels (item_rate, item_tax…) are shared with the engagement items
  // editor and live under Engagements. The work-link copy is this screen's own
  // and lives under Templates. Reading both from one translator is what printed
  // `Engagements.service_does_work` on screen.
  const t = useTranslations("Engagements");
  const tT = useTranslations("Templates");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("service");
  const [previewOpen, setPreviewOpen] = useState(true);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rateCents, setRateCents] = useState<number | null>(
    initial?.rateCents ?? null,
  );
  const [rateType, setRateType] = useState<RateType>(initial?.rateType ?? "item");
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>(
    initial?.billingFrequency ?? "once",
  );
  const [taxPct, setTaxPct] = useState<number | null>(initial?.taxPct ?? null);
  const [taskTemplateId, setTaskTemplateId] = useState<string | null>(
    initial?.taskTemplateId ?? null,
  );
  /** Steps typed here instead of picking a template. Not stored on the service
   *  — they become a real task template on save. */
  const [newWorkSteps, setNewWorkSteps] = useState<string[]>([]);

  const canSave = name.trim().length > 0;
  const picked = taskTemplates.find((x) => x.id === taskTemplateId);

  // Rate reads in dollars and stores in cents. Blank stays NULL — "priced per
  // engagement" is a real service, and $0.00 would offer the work for free.
  function setRate(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") return setRateCents(null);
    const dollars = Number(trimmed.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(dollars)) setRateCents(Math.round(dollars * 100));
  }

  function priceLabel(): string {
    if (rateCents == null) return t("services_price_tbd");
    const money = formatCurrency(rateCents / 100, locale);
    const per = rateType === "hour" ? t("item_rate_hour").toLowerCase() : null;
    const freq =
      billingFrequency === "once"
        ? null
        : t(`item_freq_${billingFrequency}` as FreqKey).toLowerCase();
    return [money, per ? `/ ${per}` : null, freq].filter(Boolean).join(" ");
  }

  function save() {
    if (!canSave || pending) return;
    startTransition(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        rateCents,
        rateType,
        billingFrequency,
        taxPct,
        taskTemplateId,
        newWorkSteps,
      };
      const res = initial
        ? await updateFirmServiceAction(initial.id, payload)
        : await createFirmServiceAction(payload);
      if (!res.ok) {
        toast.error(
          res.needsMigration
            ? t("services_needs_migration")
            : t("services_failed"),
        );
        return;
      }
      router.push("/templates/services");
    });
  }

  return (
    <TemplateBuilderShell
      title={initial ? t("services_edit") : t("services_add")}
      explainer={tT("service_builder_explainer")}
      tabs={TABS.map((key) => ({
        key,
        label: tT(`tab_service_${key}` as TabKey),
        // Only the name stops you saving, so only its tab can be incomplete.
        incomplete: key === "service" && name.trim().length === 0,
      }))}
      activeTab={tab}
      onTabChange={(key) => setTab(key as Tab)}
      actions={[
        {
          label: t("services_save"),
          disabled: !canSave || pending,
          onClick: save,
        },
      ]}
      onClose={() => router.push("/templates/services")}
      previewOpen={previewOpen}
      onPreviewToggle={() => setPreviewOpen((v) => !v)}
      preview={
        <div className="mx-auto max-w-md space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tT("service_preview_label")}
          </p>
          {/* The service as a priced line on an engagement — which is the
              thing a service actually becomes. */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              {/* An unnamed service reads as ABSENT, not as a service called
                  "Monthly bookkeeping" — the placeholder is a suggestion for
                  the field, and echoing it here makes the preview look like it
                  is already describing something real. */}
              <p
                className={cn(
                  "min-w-0 text-sm",
                  name.trim()
                    ? "font-medium"
                    : "italic text-muted-foreground",
                )}
              >
                {name.trim() || tT("preview_unnamed_service")}
              </p>
              <p className="shrink-0 text-sm tabular-nums">{priceLabel()}</p>
            </div>
            {description.trim() && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {description.trim()}
              </p>
            )}
          </div>

          {/* And the work it brings with it. Shown as its own card because
              that IS the point of the link — adding the service adds this. */}
          {(picked || newWorkSteps.some((x) => x.trim())) && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium">{tT("service_does_work")}</p>
              {/* The task template's name. When the steps were typed here
                  rather than picked, the template Vylan creates is named after
                  the service — so that is the honest label. It used to repeat
                  the form's "Saving creates a task template…" instruction,
                  which is guidance for the accountant, not something that
                  belongs in a card headed "how this lands on an engagement". */}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {picked
                  ? picked.name
                  : name.trim() || tT("preview_unnamed_service")}
              </p>
              <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
                {(picked
                  ? picked.steps
                  : newWorkSteps.map((x) => x.trim()).filter(Boolean)
                ).map((step, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <CornerDownRight
                      className="mt-0.5 size-3 shrink-0"
                      aria-hidden
                    />
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    >
      {tab === "service" && (
        <Fieldset title={tT("tab_service_service")}>
          <Field label={`${t("services_name")} *`} htmlFor="svc-name">
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("services_name_placeholder")}
            />
          </Field>
          <Field label={t("item_description")} htmlFor="svc-desc">
            <Textarea
              id="svc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t("services_description_placeholder")}
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("services_copy_note")}
          </p>
        </Fieldset>
      )}

      {tab === "pricing" && (
        <Fieldset title={tT("tab_service_pricing")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("item_rate")} htmlFor="svc-rate">
              <Input
                id="svc-rate"
                inputMode="decimal"
                value={rateCents == null ? "" : (rateCents / 100).toFixed(2)}
                onChange={(e) => setRate(e.target.value)}
                placeholder={t("services_rate_placeholder")}
              />
            </Field>
            <Field label={t("item_rate_type")} htmlFor="svc-ratetype">
              <select
                id="svc-ratetype"
                value={rateType}
                onChange={(e) => setRateType(e.target.value as RateType)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {RATE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {t(`item_rate_${r}` as RateKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("item_billing_frequency")} htmlFor="svc-freq">
              <select
                id="svc-freq"
                value={billingFrequency}
                onChange={(e) =>
                  setBillingFrequency(e.target.value as BillingFrequency)
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {BILLING_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {t(`item_freq_${f}` as FreqKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("item_tax")} htmlFor="svc-tax">
              <Input
                id="svc-tax"
                inputMode="decimal"
                value={taxPct == null ? "" : String(taxPct)}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setTaxPct(v === "" ? null : Number(v) || 0);
                }}
                placeholder="—"
              />
            </Field>
          </div>
        </Fieldset>
      )}

      {tab === "work" && (
        <Fieldset title={tT("service_does_work")}>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {tT("service_does_work_hint")}
          </p>

          {/* The picker is only drawn when the firm HAS task templates — a
              dropdown whose only entry is "none" teaches nobody that the
              feature exists, it just adds a control that does nothing. */}
          {taskTemplates.length > 0 && (
            <Field label={tT("service_does_work")} htmlFor="svc-work">
              <select
                id="svc-work"
                value={taskTemplateId ?? ""}
                onChange={(e) => {
                  setTaskTemplateId(e.target.value || null);
                  // Picking an existing one clears anything half-typed, so the
                  // two inputs can never both claim to be the work.
                  setNewWorkSteps([]);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{tT("service_does_work_none")}</option>
                {taskTemplates.map((tt) => (
                  <option key={tt.id} value={tt.id}>
                    {tt.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* The steps of whatever is picked, so you can see what you attached
              rather than remember what is inside a name. */}
          {picked && picked.steps.length > 0 && (
            <ul className="space-y-1.5 border-l-2 border-border pl-3">
              {picked.steps.map((step, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-muted-foreground"
                >
                  <CornerDownRight className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {step}
                </li>
              ))}
            </ul>
          )}

          {/* Type the steps instead. Shown when nothing is picked, so the form
              always offers a way forward even on a firm with no task templates
              at all — which is what the founder hit. */}
          {!taskTemplateId && (
            <div className="space-y-2">
              {newWorkSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <CornerDownRight
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={step}
                    onChange={(e) =>
                      setNewWorkSteps((prev) =>
                        prev.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                    placeholder={tT("service_step_placeholder")}
                    aria-label={tT("service_step_placeholder")}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setNewWorkSteps((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label={tT("remove")}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setNewWorkSteps((prev) => [...prev, ""])}
              >
                <Plus className="size-3.5" />
                {newWorkSteps.length === 0
                  ? tT("service_define_work")
                  : tT("service_add_step")}
              </Button>
              {newWorkSteps.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {tT("service_new_template_note")}
                </p>
              )}
            </div>
          )}
        </Fieldset>
      )}
    </TemplateBuilderShell>
  );
}
