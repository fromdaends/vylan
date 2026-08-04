"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClampedNumberInput } from "@/components/ui/clamped-number-input";
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
import {
  Plus,
  Trash2,
  GripVertical,
  Sparkles,
  Receipt,
  BellRing,
  ChevronDown,
  Repeat,
  Upload,
  UserPlus,
  AlertTriangle,
} from "lucide-react";
import {
  findScopeWarning,
  type ScopeWarningContact,
} from "@/lib/relationships/validate";
import { addDays } from "date-fns";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { createEngagementAction } from "@/app/actions/engagements";
import type { Template, TemplateItem, DocType } from "@/lib/db/templates";
import {
  EngagementItemsEditor,
  type CatalogueService,
} from "@/components/engagements/engagement-items-editor";
import type { EngagementItemDraft } from "@/lib/engagements/items";
import { EngagementModalShell } from "@/components/engagements/engagement-modal-shell";
import { EngagementStartChooser } from "@/components/engagements/engagement-start-chooser";
import { SaveAsTemplateDialog } from "@/components/engagements/save-as-template-dialog";
import {
  readPayload,
  type EngagementTemplatePayload,
} from "@/lib/engagements/template-payload";
import { EngagementWizardRail } from "@/components/engagements/engagement-wizard-rail";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import { DayOfMonthPicker } from "@/components/engagements/day-of-month-picker";
import { SelectableTemplateCard } from "@/components/templates/template-card";
import { templateItemApplies } from "@/lib/doc-types";
import { resolveInitialTemplate } from "@/lib/engagements/initial-template";
import {
  resolveInvoiceAmountCents,
  hasUsableSavedPrice,
} from "@/lib/invoices/resolve";
import {
  localizedTemplateName,
  BLANK_TEMPLATE_SEED_ID,
} from "@/lib/templates/builtin-names";
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
  type ReminderStep,
  type ReminderTone,
} from "@/lib/reminder-settings";

type KnownErrorKey =
  | "missing_client"
  | "missing_template"
  | "missing_title"
  | "create_failed"
  | "min_2_chars"
  | "too_long"
  | "no_documents"
  | "invoice_amount_required"
  | "invoice_attachment_too_large"
  | "invoice_attachment_type"
  | "invoice_attachment_upload_error";
// Next year down to 6 back — the practical range for a new engagement (late
// prior-year filings included) without a free-text year field.
const TAX_YEAR_OPTIONS = (() => {
  const next = new Date().getFullYear() + 1;
  return Array.from({ length: 8 }, (_, i) => next - i);
})();

const KNOWN_ERRORS = new Set<string>([
  "missing_client",
  "missing_template",
  "missing_title",
  "create_failed",
  "min_2_chars",
  "too_long",
  "no_documents",
  "invoice_amount_required",
  "invoice_attachment_too_large",
  "invoice_attachment_type",
  "invoice_attachment_upload_error",
]);

export type InvoiceAutoMode = "off" | "on_completion" | "delayed";
// Builder-local timing. Adds "now": create the invoice immediately at engagement
// creation (payable right away), vs. the deferred on_completion / delayed
// automation. "off" = no invoice.
export type InvoiceTiming = "off" | "now" | "on_completion" | "delayed";

// The rail's order IS the order of the decision: who it is for, what you are
// asking them for, what it costs, how hard you chase.
// Services sits SECOND, right after who it is for. It is the scope — what you
// are doing and for how much — and everything after it depends on it: the
// invoice is built from these lines, and tasks will hang off them. Documents
// follows, because what you need FROM the client is decided once you know what
// you are doing for them.
const WIZARD_STEPS = [
  "details",
  "services",
  "documents",
  "billing",
  "reminders",
] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];
// Spelled out so a typo in the template literal is a compile error rather than
// a `Engagements.wizard_step_detials` rendering on screen — this repo has been
// bitten twice by next-intl failing silently on a bad key.
type WizardStepKey =
  | "wizard_step_details"
  | "wizard_step_services"
  | "wizard_step_documents"
  | "wizard_step_billing"
  | "wizard_step_reminders";

export function EngagementBuilder({
  clients,
  templates,
  initialClientId,
  initialTemplateId,
  locale,
  includeQuebecForms = true,
  servicePrices = {},
  services = [],
  engagementTemplates = [],
  connectReady = false,
  invoiceDefaultMode = "off",
  invoiceDefaultDelayDays = null,
  reminderDefaultSettings = null,
  canManageReminderDefaults = false,
  authorizedContacts = {},
}: {
  clients: ComboboxClient[];
  templates: Template[];
  // Recipient safety (relationships spec §3): each BUSINESS client's linked
  // authorized contacts, keyed by business client id. Everything sent on the
  // engagement goes to the client record's email — when that address belongs
  // to one of these contacts and their scopes don't cover the chosen
  // engagement type, a non-blocking warning renders under the client picker.
  authorizedContacts?: Record<string, ScopeWarningContact[]>;
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
  /** The firm's service catalogue (migration 1480). Empty until it is applied. */
  services?: CatalogueService[];
  /** Saved whole-engagement templates (migration 1500). */
  engagementTemplates?: {
    id: string;
    name: string;
    access: "team" | "private";
    payload: EngagementTemplatePayload;
  }[];
  // Whether the firm can receive payments (Stripe Connect charges enabled).
  // Invoice automation is only offered when true.
  connectReady?: boolean;
  // Firm-wide default invoice automation (migration 0590) — pre-selects here.
  invoiceDefaultMode?: InvoiceAutoMode;
  invoiceDefaultDelayDays?: number | null;
  // Optional firm preset (migration 0670). It is copied into this engagement,
  // so customizing this form never mutates the saved firm default.
  reminderDefaultSettings?: ReminderSettings | null;
  canManageReminderDefaults?: boolean;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  // Scope names live in the Clients namespace, shared with the profile card.
  const tClients = useTranslations("Clients");

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
  // Optional structured tax year ("" = none). Options: next year down to 6
  // back — covers late prior-year filings without a free-text field.
  const [taxYear, setTaxYear] = useState("");
  // "AI Analyze" toggle — on by default. When off, no document the client
  // uploads to this engagement is sent to the AI (saves AI usage/cost).
  const [aiEnabled, setAiEnabled] = useState(true);
  // Repeat (recurring series, migration 0770): off by default. When set, the
  // engagement becomes a series that auto-creates the next occurrence each
  // cycle, due repeatOffsetDays after it opens.
  const [repeatFrequency, setRepeatFrequency] = useState<
    "off" | "monthly" | "quarterly" | "yearly" | "custom"
  >("off");
  const [repeatOffsetDays, setRepeatOffsetDays] = useState<string>("15");
  // Custom schedule ("every N months on day D", migration 0890). Strings so the
  // number inputs can be cleared while typing; clamped on submit.
  const [repeatIntervalMonths, setRepeatIntervalMonths] = useState<string>("2");
  const [repeatAnchorDay, setRepeatAnchorDay] = useState<string>("");
  // Invoice recurrence (Phase 4): recreate this engagement's invoice on every
  // occurrence. OFF by default — billing repeats only when explicitly chosen.
  const [repeatInvoiceRecreate, setRepeatInvoiceRecreate] = useState(false);
  // Scroll target for the Repeat section's "Set up the invoice" shortcut.
  const invoiceSectionRef = useRef<HTMLDivElement>(null);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(
    () =>
      structuredClone(reminderDefaultSettings ?? DEFAULT_REMINDER_SETTINGS),
  );
  const [reminderPreset, setReminderPreset] = useState<
    "firm" | "vylan" | "custom"
  >(() => (reminderDefaultSettings ? "firm" : "vylan"));
  const [reminderPreviewBase] = useState(() => new Date());
  const [remindersExpanded, setRemindersExpanded] = useState(false);
  // Invoice timing (migrations 0590 + 0610). Pre-selected from the firm default.
  // Only meaningful when Connect is ready; forced off otherwise.
  const [invoiceMode, setInvoiceMode] = useState<InvoiceTiming>(
    connectReady ? invoiceDefaultMode : "off",
  );
  const [invoiceDelayDays, setInvoiceDelayDays] = useState<string>(
    invoiceDefaultDelayDays != null ? String(invoiceDefaultDelayDays) : "7",
  );
  // Amount source: use the firm's saved service price, or a custom amount.
  const [invoiceUseDefault, setInvoiceUseDefault] = useState(true);
  const [invoiceCustomAmount, setInvoiceCustomAmount] = useState<string>("");
  // Optional invoice description + the deliverables lock (migration 0610).
  const [invoiceDescription, setInvoiceDescription] = useState<string>("");
  const [invoiceLock, setInvoiceLock] = useState(false);
  const [invoiceAttachment, setInvoiceAttachment] = useState<File | null>(null);
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

  // ── The wizard ────────────────────────────────────────────────────────────
  //
  // Founder's reference is Canopy's Create Engagement modal: a left rail of
  // steps, each ticked once it has what it needs, with one step's worth of form
  // on the right.
  //
  // This is a REGROUPING, not a rewrite. Every card below is the same card it
  // was on the single-page form, with the same state and the same handlers —
  // they are only shown one group at a time and put in an order that follows
  // the decision rather than the order they happened to be built in.
  //
  // FOUR steps, not Canopy's five. Terms and Tasks are not here because Vylan
  // has neither yet, and a step that opens on an empty panel is worse than a
  // step that is not offered: it reads as broken rather than as unbuilt. The
  // rail grows as they land.
  // The priced scope (migration 1450). Starts empty — an engagement without one
  // is still perfectly valid, and is what every engagement was until now.
  const [serviceItems, setServiceItems] = useState<EngagementItemDraft[]>([]);
  const [step, setStep] = useState<WizardStep>("details");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Load a saved engagement template into the form. Everything it carries is
  // applied; everything it does not is left exactly as it was. Notably it does
  // NOT touch the client — a template is a kind of work, not a kind of work for
  // one person, so the client stays whatever the caller set.
  function applyEngagementTemplate(id: string) {
    const tpl = engagementTemplates.find((x) => x.id === id);
    if (!tpl) return;
    const p = tpl.payload;
    if (p.title.trim() !== "") {
      setTitle(p.title);
      // Marked touched so the auto-title does not overwrite what the template
      // just supplied the moment a client is picked.
      setTitleTouched(true);
    }
    if (p.items.length > 0) setServiceItems(p.items);
    if (p.checklist.length > 0) {
      setItems(
        p.checklist.map((c) => ({
          label_en: c.label_en,
          label_fr: c.label_fr,
          description_en: c.description_en ?? "",
          description_fr: c.description_fr ?? "",
          doc_type: c.doc_type ?? null,
          required: c.required,
        })) as TemplateItem[],
      );
    }
  }

  // The start chooser (Canopy's opening question) shows FIRST and the builder is
  // not rendered behind it. ALWAYS — including for a firm with no templates at
  // all.
  //
  // It used to skip itself when there was nothing to pick, on the grounds that a
  // question with one answer is not a question. The founder overruled that and
  // was right: "even without owning an engagement template still have that pre
  // two option thing... it shouldnt directly bring you to the start from
  // scratch." The question is not there only to be answered — it is how anybody
  // finds out engagement templates exist at all. A firm that is never shown the
  // choice never learns it had one, and the empty state on that card says
  // exactly what is missing and how to get it.
  //
  // Deep links (?client=, ?template=) do not skip it either: they answer WHICH
  // CLIENT or which document checklist, which is a different question from
  // whether to start from a saved engagement.
  const [started, setStarted] = useState(false);

  // A tick means "this step has what it NEEDS", not "you have been here".
  // Rewarding a visit would put a tick on an empty Documents step, which is the
  // one thing that actually blocks sending.
  const stepComplete: Record<WizardStep, boolean> = {
    details: clientId != null && title.trim().length > 0,
    // Optional on purpose. An engagement with no priced scope is exactly what
    // every engagement in Vylan was until now, and refusing to send one would
    // break the existing flow for a field nobody has filled in yet.
    services: true,
    documents: items.length > 0,
    // Money and chasing are genuinely optional — a draft with neither is a
    // valid engagement — so they are complete by definition. They still get a
    // tick rather than nothing, because an empty circle beside a step you were
    // never required to fill reads as an error.
    billing: true,
    reminders: true,
  };
  const stepIndex = WIZARD_STEPS.indexOf(step);
  // How many times "Create and send" was pressed with an empty checklist.
  // From the 2nd attempt we ring the checklist so the reason is obvious.
  const [emptyAttempts, setEmptyAttempts] = useState(0);
  const [pending, startTransition] = useTransition();

  const selectedTemplate = templates.find((tt) => tt.id === templateId);
  const selectedClient = clients.find((client) => client.id === clientId);
  // Non-blocking recipient-scope warning for the picked client + engagement
  // type. Pure email match against the passed contacts — null for individuals,
  // for types with no scope domain (t1/custom), and when scopes cover it.
  const scopeWarning =
    selectedClient && selectedTemplate
      ? findScopeWarning(
          selectedClient.email,
          selectedTemplate.type,
          authorizedContacts[selectedClient.id] ?? [],
        )
      : null;
  // The chosen client's province drives which document types apply. Quebec
  // clients get the RL slips; everyone else (or province not set) doesn't.
  const selectedProvince =
    clients.find((c) => c.id === clientId)?.province ?? null;

  // The firm's saved default price (cents) for this engagement type — pre-fills
  // the invoice amount. Null if no default set for the type.
  const invoiceDefaultCents = selectedTemplate
    ? (servicePrices[selectedTemplate.type] ?? null)
    : null;
  // Whether that saved price can actually be billed. Asks the SAME question
  // resolveInvoiceAmountCents does (positive, not merely present), so the UI
  // can't offer a $0 saved price that the resolver would then ignore.
  const hasSavedPrice = hasUsableSavedPrice(invoiceDefaultCents);
  // The amount to bill from the current invoice choices (shared pure helper).
  // The helper only distinguishes "off" from any billing mode, so "now" maps to
  // a non-off mode for the amount calculation.
  function currentInvoiceAmountCents(): number | null {
    return resolveInvoiceAmountCents({
      mode: invoiceMode === "off" ? "off" : "on_completion",
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

  function updateReminderStep(
    tone: ReminderTone,
    patch: Partial<ReminderStep>,
  ) {
    setReminderPreset("custom");
    setReminderSettings((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.tone === tone ? { ...step, ...patch } : step,
      ),
    }));
  }

  function applyReminderPreset(value: "firm" | "vylan" | "custom") {
    if (value === "custom") return;
    setReminderPreset(value);
    setReminderSettings((current) => ({
      ...structuredClone(
        value === "firm" && reminderDefaultSettings
          ? reminderDefaultSettings
          : DEFAULT_REMINDER_SETTINGS,
      ),
      enabled: current.enabled,
    }));
  }

  function reminderSchedulePreview(step: ReminderStep): string | null {
    const anchor =
      step.timing === "after_due"
        ? dueDate
          ? new Date(`${dueDate}T23:59:59Z`)
          : null
        : reminderPreviewBase;
    if (!anchor) return null;
    const formatter = new Intl.DateTimeFormat(
      locale === "fr" ? "fr-CA" : "en-CA",
      {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      },
    );
    return Array.from({ length: step.repeatCount }, (_, index) =>
      formatter.format(addDays(anchor, step.days * (index + 1))),
    ).join(" · ");
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

    // Any invoice (created now OR automated) needs a valid amount up front.
    // Guard client-side to match the server refine.
    const invoiceAmountCents = currentInvoiceAmountCents();
    if (invoiceMode !== "off" && invoiceAmountCents == null) {
      setError("invoice_amount_required");
      return;
    }
    const createNow = invoiceMode === "now";
    // Only the deferred timings persist as an automation mode; "now" creates the
    // invoice immediately and leaves the automation off.
    const autoMode: InvoiceAutoMode =
      invoiceMode === "on_completion" || invoiceMode === "delayed"
        ? invoiceMode
        : "off";
    const invoiceDelay =
      invoiceMode === "delayed"
        ? Math.max(1, Math.floor(Number(invoiceDelayDays) || 0))
        : null;
    const invoiceActive = invoiceMode !== "off";

    startTransition(async () => {
      try {
        const result = await createEngagementAction(
          {
            client_id: clientId,
            title: effectiveTitle.trim(),
            type: selectedTemplate.type,
            due_date: dueDate || null,
            tax_year: taxYear ? Number(taxYear) : null,
            ai_enabled: aiEnabled,
            invoice_auto_mode: autoMode,
            invoice_delay_days: invoiceDelay,
            invoice_amount_cents: invoiceAmountCents,
            invoice_create_now: createNow,
            invoice_locks_deliverables: invoiceActive ? invoiceLock : false,
            invoice_description: invoiceActive
              ? invoiceDescription.trim() || null
              : null,
            // Only lines the accountant actually filled in. A row added by a
            // stray "+ Add service" click must not reach the client's proposal
            // as a nameless $0 line.
            service_items: serviceItems
              .filter((i) => i.name.trim().length > 0)
              .map((i) => ({
                name: i.name.trim(),
                service_id: i.serviceId,
                description: i.description,
                rate_cents: i.rateCents,
                rate_type: i.rateType,
                billing_frequency: i.billingFrequency,
                tax_pct: i.taxPct,
              })),
            reminder_settings: reminderSettings,
            repeat_frequency: repeatFrequency,
            // Custom schedule only; null keeps a fixed-frequency series
            // inserting exactly the columns it did before migration 0890.
            repeat_interval_months:
              repeatFrequency === "custom"
                ? Math.min(
                    24,
                    Math.max(1, Math.floor(Number(repeatIntervalMonths) || 1)),
                  )
                : null,
            repeat_anchor_day:
              repeatFrequency === "custom"
                ? Math.min(
                    31,
                    Math.max(
                      1,
                      Math.floor(
                        Number(repeatAnchorDay) || new Date().getDate(),
                      ),
                    ),
                  )
                : null,
            repeat_due_offset_days:
              repeatFrequency !== "off"
                ? Math.min(
                    365,
                    Math.max(1, Math.floor(Number(repeatOffsetDays) || 15)),
                  )
                : null,
            repeat_invoice_recreate:
              repeatFrequency !== "off" &&
              invoiceMode !== "off" &&
              repeatInvoiceRecreate,
            items: cleanItems,
            send,
            locale,
          },
          invoiceActive ? invoiceAttachment : null,
        );
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

  // Built on demand rather than kept in state: it must reflect the form as it
  // is RIGHT NOW, not as it was when something last re-rendered.
  function currentTemplatePayload(): EngagementTemplatePayload {
    return readPayload({
      title,
      type: selectedTemplate?.type ?? null,
      items: serviceItems,
      checklist: items,
      // The opaque steps go in whole. This component does not need to know
      // their shape, and the reader does not inspect them.
      invoice: { mode: invoiceMode },
      reminders: reminderSettings as unknown as Record<string, unknown>,
      repeat: null,
    });
  }

  if (!started) {
    return (
      <EngagementModalShell
        title={t("new_title")}
        closeHref="/engagements"
        labels={{
          close: tc("cancel"),
          save: t("wizard_save"),
          saveDraft: t("save_draft"),
          saveAndSend: t("create_and_send"),
          saveAsTemplate: t("save_as_template"),
          saving: tc("saving"),
        }}
        onSaveDraft={() => {}}
        onSaveAndSend={() => {}}
      >
        <EngagementStartChooser
          templates={engagementTemplates.map((x) => ({
            id: x.id,
            name: x.name,
            access: x.access,
          }))}
          onStart={(id) => {
            if (id) applyEngagementTemplate(id);
            setStarted(true);
          }}
        />
      </EngagementModalShell>
    );
  }

  return (
    <EngagementModalShell
      title={t("new_title")}
      closeHref="/engagements"
      busy={pending}
      onSaveDraft={() => submit(false)}
      onSaveAndSend={() => submit(true)}
      onSaveAsTemplate={() => setSavingTemplate(true)}
      labels={{
        close: tc("cancel"),
        save: t("wizard_save"),
        saveDraft: t("save_draft"),
        saveAndSend: t("create_and_send"),
        saveAsTemplate: t("save_as_template"),
        saving: tc("saving"),
      }}
    >
    <SaveAsTemplateDialog
      open={savingTemplate}
      onOpenChange={setSavingTemplate}
      payload={currentTemplatePayload()}
      suggestedName={title.trim()}
    />

    {/* Rail left, one step's worth of form right. The rail is sticky so it
        stays a table of contents on a long step rather than scrolling with it.
        The rail is a FIXED 17rem and the form takes everything else. A
        A fractional rail (1fr_3fr) would grow the table of contents on a wide
        monitor, which is the one thing here that gains nothing from extra
        width — the form is where the room is needed. */}
    <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
      <div className="lg:sticky lg:top-6">
        <EngagementWizardRail
          label={t("wizard_nav_label")}
          current={step}
          onSelect={setStep}
          steps={WIZARD_STEPS.map((k) => ({
            key: k,
            label: t(`wizard_step_${k}` as WizardStepKey),
            complete: stepComplete[k],
            // Only the two that actually stop you sending are marked required.
            required: k === "details" || k === "documents",
          }))}
        />
      </div>

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

      {/* STEP 1 — who it is for and what it is called. Client, template and the name/dates were three cards in a row already; the wizard just names that group. */}
      {step === "details" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("section_client")}</CardTitle>
            </CardHeader>
            <CardContent>
              {clients.length === 0 ? (
                /* A firm with no clients yet would otherwise see the combobox's
                   bare "No client found" — a confusing dead end. Guide them to add
                   a client first (clients are created from the Clients page). */
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 px-6 py-8 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserPlus className="size-5" aria-hidden />
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {t("no_clients_title")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("no_clients_body")}
                    </p>
                  </div>
                  <Button asChild size="sm" className="mt-1">
                    <Link href="/clients">
                      <UserPlus className="size-4" />
                      {t("no_clients_cta")}
                    </Link>
                  </Button>
                </div>
              ) : (
                /* chooseClient re-filters the checklist for the new client's province */
                <ClientCombobox
                  clients={clients}
                  value={clientId}
                  onChange={chooseClient}
                />
              )}
              {scopeWarning && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  {t("rel_scope_warning", {
                    name: scopeWarning.name,
                    scopes: scopeWarning.scopes
                      .map((s) => tClients(`rel_scope_${s}`))
                      .join(", "),
                  })}
                </p>
              )}
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
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
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
              {/* Structured tax year (migration 0900). Optional — drives document
                  filing's {year} and, later, the AI's expected-year context. */}
              <div className="space-y-1.5">
                <Label htmlFor="tax_year">{t("builder_tax_year_label")}</Label>
                <select
                  id="tax_year"
                  value={taxYear}
                  onChange={(e) => setTaxYear(e.target.value)}
                  className="h-10 w-fit min-w-32 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-all hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <option value="">{t("builder_tax_year_none")}</option>
                  {TAX_YEAR_OPTIONS.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {t("builder_tax_year_hint")}
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
            </CardContent>
          </Card>
        </>
      )}

      {/* STEP 2 — the SCOPE. What you are doing for them and what it costs.
          Not the document checklist: that answers "what do I need FROM the
          client", this answers "what am I DOING for them". They were the same
          thing only because one of them had no table (migration 1450). */}
      {step === "services" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("section_services")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("section_services_hint")}
            </p>
          </CardHeader>
          <CardContent>
            <EngagementItemsEditor
              items={serviceItems}
              onChange={setServiceItems}
              locale={locale}
              services={services}
            />
          </CardContent>
        </Card>
      )}

      {/* STEP 3 — what you are asking the client for. This card used to be LAST on the page, below invoicing and reminders, which buried the one part of an engagement the client actually sees. */}
      {step === "documents" && (
        <>
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
        </>
      )}

      {/* STEP 3 — money. Repeat and Invoice belong together: whether the job recurs and what it costs are one decision, and they were separated by the whole reminders section. */}
      {step === "billing" && (
        <>
          {/* Repeat (recurring series, migration 0770) — its own top-level card
              (founder feedback: Repeat / Reminders / Invoice should read as
              separate sections, not one packed Details card). Invoice recurrence
              stays IN here with Repeat: it's a property of the series. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Repeat className="size-4 text-muted-foreground" aria-hidden />
                {t("repeat_section_label")}
              </CardTitle>
              <Select
                value={repeatFrequency}
                onValueChange={(value) => {
                  const next = value as
                    | "off"
                    | "monthly"
                    | "quarterly"
                    | "yearly"
                    | "custom";
                  setRepeatFrequency(next);
                  // Default the day to today when Custom is first chosen (the fixed
                  // frequencies anchor on the setup day implicitly). Set on a real
                  // interaction so first paint stays deterministic.
                  if (next === "custom" && repeatAnchorDay === "") {
                    setRepeatAnchorDay(String(new Date().getDate()));
                  }
                }}
              >
                <SelectTrigger
                  id="repeat-frequency"
                  className="w-40"
                  aria-label={t("repeat_section_label")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t("repeat_off")}</SelectItem>
                  <SelectItem value="monthly">{t("repeat_monthly")}</SelectItem>
                  <SelectItem value="quarterly">{t("repeat_quarterly")}</SelectItem>
                  <SelectItem value="yearly">{t("repeat_yearly")}</SelectItem>
                  <SelectItem value="custom">{t("repeat_custom")}</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("repeat_section_hint")}
              </p>

              {/* Custom schedule: every N months, on a chosen day. */}
              {repeatFrequency === "custom" && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{t("repeat_custom_every")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={24}
                      value={repeatIntervalMonths}
                      onChange={(e) => setRepeatIntervalMonths(e.target.value)}
                      aria-label={t("repeat_custom_every_label")}
                      className="h-8 w-20"
                    />
                    <span>{t("repeat_custom_months")}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{t("repeat_custom_on_day")}</span>
                    {/* Same calendar picker as the engagement page's Repeat dialog,
                        so setting a schedule feels identical in both places. */}
                    <DayOfMonthPicker
                      value={
                        repeatAnchorDay === "" ? null : Number(repeatAnchorDay)
                      }
                      locale={locale}
                      onChange={(day) => setRepeatAnchorDay(String(day))}
                    />
                  </div>
                </div>
              )}

              {repeatFrequency !== "off" && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{t("repeat_due_offset_label")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={repeatOffsetDays}
                      onChange={(e) => setRepeatOffsetDays(e.target.value)}
                      aria-label={t("repeat_due_offset_label")}
                      className="h-8 w-20"
                    />
                    <span>{t("repeat_due_offset_suffix")}</span>
                  </div>
                )}

              {/* Invoice recurrence (Phase 4) — WITH Repeat, it's a property of
                  the series (founder spec). With an invoice timing chosen it's
                  the switch; with the Invoice card off it's a "Set up the
                  invoice" shortcut that scrolls there, so the setting stays
                  discoverable. The recurrence decides WHETHER each occurrence
                  bills; the invoice timing decides WHEN. */}
              {repeatFrequency !== "off" && connectReady && (
                <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-3">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="repeat-invoice-recreate"
                      className="flex cursor-pointer items-center gap-1.5"
                    >
                      <Receipt
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      {t("repeat_invoice_label")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {invoiceMode !== "off"
                        ? t("repeat_invoice_hint")
                        : t("repeat_invoice_off_hint")}
                    </p>
                  </div>
                  {invoiceMode !== "off" ? (
                    <Switch
                      id="repeat-invoice-recreate"
                      checked={repeatInvoiceRecreate}
                      onCheckedChange={setRepeatInvoiceRecreate}
                      ariaLabel={t("repeat_invoice_label")}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() =>
                        invoiceSectionRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        })
                      }
                    >
                      {t("repeat_invoice_set_button")}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoice (migrations 0590 + 0610) — its own top-level card. The
              wrapper div is the scroll target of the Repeat card's "Set up the
              invoice" shortcut. Without Stripe Connect the card still shows, with
              the connect note, so the section isn't silently absent. */}
          <div ref={invoiceSectionRef}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <Receipt className="size-4 text-muted-foreground" aria-hidden />
                  {t("invoice_section_label")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {connectReady ? (
                  <>
                  <p className="text-xs text-muted-foreground">
                    {t("invoice_section_hint")}
                  </p>
                  <Select
                    value={invoiceMode}
                    onValueChange={(v) => setInvoiceMode(v as InvoiceTiming)}
                  >
                    <SelectTrigger className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">{t("invoice_mode_off")}</SelectItem>
                      <SelectItem value="now">{t("invoice_mode_now")}</SelectItem>
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
                      {/* The saved-price choice only exists when there IS a saved
                          price. Before this, the first radio stayed on screen with
                          the label "No saved price for this service" and disabled —
                          a sentence of FACT dressed as an option, which reads as a
                          button that won't work (the founder reported exactly
                          that). With nothing to choose between, say why in one line
                          and let them type the amount. */}
                      {hasSavedPrice ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name="invoice-amount-source"
                              checked={invoiceUseDefault}
                              onChange={() => setInvoiceUseDefault(true)}
                            />
                            {t("invoice_use_default", {
                              amount: ((invoiceDefaultCents ?? 0) / 100).toFixed(2),
                            })}
                          </label>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name="invoice-amount-source"
                              checked={!invoiceUseDefault}
                              onChange={() => setInvoiceUseDefault(false)}
                            />
                            {t("invoice_custom")}
                          </label>
                        </div>
                      ) : (
                        <p className="text-xs leading-snug text-muted-foreground">
                          {t("invoice_no_default_hint")}
                        </p>
                      )}
                      {(!invoiceUseDefault || !hasSavedPrice) && (
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

                  {/* Optional description + the deliverables lock (migration 0610).
                      The lock is captured here; it gates the Final documents section
                      in a later phase. */}
                  {invoiceMode !== "off" && (
                    <div className="space-y-3 border-t border-border/60 pt-3">
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="invoice-description"
                          className="text-xs text-muted-foreground"
                        >
                          {t("request_payment_description")}
                        </Label>
                        <Textarea
                          id="invoice-description"
                          value={invoiceDescription}
                          onChange={(e) => setInvoiceDescription(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder={t("request_payment_description_ph")}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="automated-invoice-attachment"
                          className="text-xs text-muted-foreground"
                        >
                          {t("invoice_attachment")}
                        </Label>
                        <label
                          htmlFor="automated-invoice-attachment"
                          className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/50"
                        >
                          <Upload className="size-4" aria-hidden />
                          {invoiceAttachment?.name ?? t("invoice_attachment_choose")}
                        </label>
                        <input
                          id="automated-invoice-attachment"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                          className="sr-only"
                          onChange={(event) =>
                            setInvoiceAttachment(event.target.files?.[0] ?? null)
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("invoice_attachment_hint")}
                        </p>
                      </div>
                      <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={invoiceLock}
                          onChange={(e) => setInvoiceLock(e.target.checked)}
                        />
                        <span>
                          <span className="block">{t("invoice_lock_label")}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t("invoice_lock_hint")}
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    {t("invoice_auto_needs_connect")}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* STEP 4 — chasing. Canopy has no equivalent step; Vylan does, because Vylan chases the documents from step 2 on your behalf. */}
      {step === "reminders" && (
        <>
          {/* Automatic reminders — its own top-level card. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <BellRing className="size-4 text-muted-foreground" aria-hidden />
                {t("reminder_section_label")}
              </CardTitle>
              <Switch
                id="automatic-reminders"
                checked={reminderSettings.enabled}
                onCheckedChange={(enabled) =>
                  setReminderSettings((current) => ({ ...current, enabled }))
                }
                ariaLabel={t("reminder_section_label")}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("reminder_section_hint")}
              </p>
              {selectedClient && !selectedClient.email && (
                <p className="text-xs font-medium text-destructive">
                  {t("reminder_missing_email")}
                </p>
              )}

                {reminderSettings.enabled && (
                  <>
                    {reminderDefaultSettings ? (
                      <div className="grid gap-1.5 border-t border-border/60 pt-3 sm:grid-cols-[10rem_1fr] sm:items-center">
                        <Label htmlFor="reminder-preset" className="text-xs text-muted-foreground">
                          {t("reminder_preset_label")}
                        </Label>
                        <Select
                          value={reminderPreset}
                          onValueChange={(value) =>
                            applyReminderPreset(
                              value as "firm" | "vylan" | "custom",
                            )
                          }
                        >
                          <SelectTrigger id="reminder-preset" className="max-w-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="firm">
                              {t("reminder_preset_firm")}
                            </SelectItem>
                            <SelectItem value="vylan">
                              {t("reminder_preset_vylan")}
                            </SelectItem>
                            {reminderPreset === "custom" && (
                              <SelectItem value="custom">
                                {t("reminder_preset_custom")}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : canManageReminderDefaults ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                        <p className="text-xs text-muted-foreground">
                          {t("reminder_no_default_hint")}
                        </p>
                        <Button type="button" variant="outline" size="sm" asChild>
                          <Link href="/settings?tab=automation">
                            {t("reminder_create_default")}
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <p className="text-xs text-muted-foreground">
                        {t("reminder_schedule_summary")}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemindersExpanded((open) => !open)}
                        aria-expanded={remindersExpanded}
                      >
                        {remindersExpanded
                          ? t("reminder_hide_customization")
                          : t("reminder_customize")}
                        <ChevronDown
                          className={
                            "size-4 transition-transform " +
                            (remindersExpanded ? "rotate-180" : "")
                          }
                        />
                      </Button>
                    </div>

                    {remindersExpanded && (
                      <div className="space-y-3">
                        {reminderSettings.steps.map((step) => (
                          <div
                            key={step.tone}
                            className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={step.enabled}
                                  onChange={(event) =>
                                    updateReminderStep(step.tone, {
                                      enabled: event.target.checked,
                                    })
                                  }
                                />
                                {t(`reminder_tone_${step.tone}`)}
                              </label>
                              <div className="max-w-xl space-y-1.5 text-xs text-muted-foreground">
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <ClampedNumberInput
                                    min={1}
                                    max={365}
                                    value={step.days}
                                    disabled={!step.enabled}
                                    onCommit={(days) =>
                                      updateReminderStep(step.tone, { days })
                                    }
                                    aria-label={t("reminder_days_label")}
                                    className="h-8 w-20"
                                  />
                                  <span>
                                    {step.timing === "after_due"
                                      ? t("reminder_days_after_due")
                                      : t("reminder_days_after_send")}
                                  </span>
                                  <span className="ml-1">
                                    {t("reminder_repeat_prefix")}
                                  </span>
                                  <ClampedNumberInput
                                    min={1}
                                    max={12}
                                    value={step.repeatCount}
                                    disabled={!step.enabled}
                                    onCommit={(repeatCount) =>
                                      updateReminderStep(step.tone, { repeatCount })
                                    }
                                    aria-label={t("reminder_repeat_label")}
                                    className="h-8 w-16"
                                  />
                                  <span>{t("reminder_repeat_suffix")}</span>
                                </div>
                                {step.enabled && (
                                  <p className="text-right text-[0.7rem] leading-relaxed text-muted-foreground/80">
                                    {reminderSchedulePreview(step)
                                      ? t("reminder_send_schedule", {
                                          dates: reminderSchedulePreview(step)!,
                                        })
                                      : t("reminder_send_schedule_needs_due")}
                                  </p>
                                )}
                              </div>
                            </div>

                            {step.enabled && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label className="text-xs text-muted-foreground">
                                    {t("reminder_subject_label")}
                                  </Label>
                                  <Input
                                    value={step.customSubject ?? ""}
                                    maxLength={160}
                                    onChange={(event) =>
                                      updateReminderStep(step.tone, {
                                        customSubject: event.target.value || null,
                                      })
                                    }
                                    placeholder={t("reminder_subject_placeholder")}
                                  />
                                </div>
                                <div className="space-y-1.5 sm:row-span-2">
                                  <Label className="text-xs text-muted-foreground">
                                    {t("reminder_message_label")}
                                  </Label>
                                  <Textarea
                                    value={step.customMessage ?? ""}
                                    maxLength={2000}
                                    rows={4}
                                    onChange={(event) =>
                                      updateReminderStep(step.tone, {
                                        customMessage: event.target.value || null,
                                      })
                                    }
                                    placeholder={t("reminder_message_placeholder")}
                                  />
                                </div>
                                <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                                  {t("reminder_tokens_hint")}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
            </CardContent>
          </Card>
        </>
      )}


      {/* Step navigation ONLY. Saving moved into the bar above, where it stays
          reachable on a long step instead of hiding under the form. */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {stepIndex > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep(WIZARD_STEPS[stepIndex - 1])}
            disabled={pending}
          >
            {t("wizard_back")}
          </Button>
        )}
        {stepIndex < WIZARD_STEPS.length - 1 && (
          <Button
            type="button"
            className="ml-auto"
            onClick={() => setStep(WIZARD_STEPS[stepIndex + 1])}
            disabled={pending}
          >
            {t("wizard_next")}
          </Button>
        )}
      </div>
      </div>
    </div>
    </EngagementModalShell>
  );
}
