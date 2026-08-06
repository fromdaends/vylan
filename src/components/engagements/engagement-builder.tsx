"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
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
  FileSignature,
  ScrollText,
} from "lucide-react";
import { ProposalPreview } from "@/components/engagements/proposal-preview";
// The SAME radio card the template builders use. A hand-rolled copy here was
// how this step ended up shouting "ENGAGEMENT PERIOD BEGINS ON" in caps over
// two lines while the template builder said it quietly in one — the exact
// drift the shared chrome exists to prevent.
import {
  TemplateBuilderShell,
  RadioCard,
  ToggleRow,
  type BuilderTab,
} from "@/components/templates/template-builder-shell";
import { AssetUpload } from "@/components/templates/asset-upload";
import { TermsSectionsEditor } from "@/components/engagements/terms-sections-editor";
import {
  termsToPlainText,
  type TermsSection,
} from "@/lib/engagements/terms-sections";
import { MoneyInput } from "@/components/ui/money-input";
import { saveFirmDefaultTermsAction } from "@/app/actions/firm-terms";
import { BillingTotalsPanel } from "@/components/engagements/billing-totals-panel";
import { computeBillingTotals } from "@/lib/engagements/billing-totals";
import {
  defaultPriceVisibility,
  emptyBlock,
  flattenBlocks,
  type BillingBlock,
  type PriceVisibility,
} from "@/lib/engagements/billing-blocks";
import { BillingBlocksEditor } from "@/components/templates/billing-blocks-editor";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EngagementServicesPanel } from "@/components/engagements/engagement-services-panel";
import {
  PLACEHOLDERS,
  placeholderText,
  resolvePlaceholders,
} from "@/lib/engagements/placeholders";
// The blocks editor renders the item rows now; only the catalogue type is still
// needed here, and the flat draft type comes with flattenBlocks.
import type { CatalogueService } from "@/components/engagements/engagement-items-editor";
import type { InvoiceAutoMode } from "@/lib/invoices/resolve";
import {
  emptyTask,
  meaningfulTasks,
  availableKinds,
  documentCollectionIndex,
  appendTaskTemplate,
  type TaskDraft,
} from "@/lib/engagements/task-drafts";
import { taskKindLabelKey } from "@/lib/tasks/kinds";
import type { TaskKind } from "@/lib/db/engagement-tasks";
import { EngagementModalShell } from "@/components/engagements/engagement-modal-shell";
import { EngagementStartChooser } from "@/components/engagements/engagement-start-chooser";
import { SaveAsTemplateDialog } from "@/components/engagements/save-as-template-dialog";
import {
  readPayload,
  type EngagementTemplatePayload,
  type TemplateChecklistItem,
} from "@/lib/engagements/template-payload";
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

// Imported and re-exported, NOT re-declared: this file used to carry its own
// copy of the union, so adding a timing meant remembering to widen it twice.
export type { InvoiceAutoMode };
// Builder-local timing. Adds "now": create the invoice immediately at engagement
// creation (payable right away), vs. the deferred on_completion / delayed
// automation. "off" = no invoice.
export type InvoiceTiming =
  | "off"
  | "now"
  | "on_acceptance"
  | "on_completion"
  | "delayed";

// The rail's order IS the order of the decision: who it is for, what you are
// asking them for, what it costs, how hard you chase.
// Services sits SECOND, right after who it is for. It is the scope — what you
// are doing and for how much — and everything after it depends on it: the
// invoice is built from these lines, and tasks hang off them. TASKS follows,
// because what the work actually consists of — including what you need FROM the
// client — is decided once you know what you are doing for them.
//
// There is no Documents step any more. Collecting documents is ONE KIND OF
// TASK (1370's `document_collection`), so the checklist and its template picker
// live inside that task's row rather than occupying a fifth of the wizard.
// The founder: "the templates for document collection exist purely for that
// task... it's not a whole section. It exists within that task."
/** Same list the template builder offers, so a template's period survives the
 *  trip into an engagement without landing on a value the dropdown lacks. */
const PERIOD_OPTIONS: (number | null)[] = [null, 1, 3, 6, 12, 24];

const PREVIEW_STEP_FOR: Record<
  string,
  "introduction" | "services" | "terms" | "sign"
> = {
  // Who it is for and what it is called — the top of the client's document.
  details: "introduction",
  // The priced lines, and the work and money that hang off them. All three
  // land in the client's Services section.
  services: "services",
  tasks: "services",
  billing: "services",
  // Chasing is invisible to the client, so it highlights nothing new — the
  // introduction is the honest neutral, not a section reminders belong to.
  reminders: "introduction",
  proposal: "sign",
};

const WIZARD_STEPS = [
  "details",
  "services",
  "tasks",
  "billing",
  "reminders",
  // LAST, and last on purpose: it is what the CLIENT sees, and you can only
  // review that once the work, the money and the chasing are settled. It is
  // also the step that turns an engagement into an agreement — everything
  // above it describes the job, this describes what they are agreeing to.
  "proposal",
] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];
// Spelled out so a typo in the template literal is a compile error rather than
// a `Engagements.wizard_step_detials` rendering on screen — this repo has been
// bitten twice by next-intl failing silently on a bad key.
type PlaceholderKey =
  | "placeholder_clientname"
  | "placeholder_taxyear"
  | "placeholder_currentyear"
  | "placeholder_currentmonth"
  | "placeholder_firmname";

type WizardStepKey =
  | "wizard_step_details"
  | "wizard_step_services"
  | "wizard_step_tasks"
  | "wizard_step_billing"
  | "wizard_step_reminders"
  | "wizard_step_proposal";

// The one line under each step's name in the wizard's steps box.
type WizardStepDescKey =
  | "wizard_step_desc_details"
  | "wizard_step_desc_services"
  | "wizard_step_desc_tasks"
  | "wizard_step_desc_billing"
  | "wizard_step_desc_reminders"
  | "wizard_step_desc_proposal";

export function EngagementBuilder({
  clients,
  templates,
  initialClientId,
  initialTemplateId,
  initialEngagementTemplateId,
  locale,
  includeQuebecForms = true,
  servicePrices = {},
  services = [],
  engagementTemplates = [],
  taskTemplates = [],
  members = [],
  connectReady = false,
  invoiceDefaultMode = "off",
  invoiceDefaultDelayDays = null,
  reminderDefaultSettings = null,
  canManageReminderDefaults = false,
  canManageFirmTerms = false,
  firmDefaultTerms = "",
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
  /** A saved WHOLE engagement (1500) chosen before arriving — "Use" on the
   *  Templates page. Unlike the other deep links this one DOES skip the start
   *  chooser, because it is an answer to the chooser's own question. */
  initialEngagementTemplateId?: string;
  locale: "fr" | "en";
  // Firm-wide setting (migration 0350). When false, the Quebec-only RL slips
  // never appear in this firm's checklists, whatever the client's province.
  includeQuebecForms?: boolean;
  // Per-service default prices in cents (firms.service_prices), keyed by
  // engagement type — pre-fills the invoice amount.
  servicePrices?: Record<string, number>;
  /** The firm's service catalogue (migration 1480). Empty until it is applied. */
  services?: CatalogueService[];
  /** Active firm members, for the assignee picker. Empty in a solo firm, which
   *  hides the control entirely — there is nobody else to hand it to. */
  members?: { id: string; name: string }[];
  /** Saved sets of tasks (migration 1570). Empty before it is applied, which
   *  hides the picker entirely — there is nothing to pick. */
  taskTemplates?: {
    id: string;
    name: string;
    /** The parent task's kind. */
    kind: TaskKind;
    /** The steps under it. */
    subtasks: { title: string }[];
    /** The client request the parent carries, if any. */
    checklist?: TemplateChecklistItem[];
  }[];
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
  /** Whether this person may CHANGE the firm's standard terms. Writing terms
   *  onto one engagement is not the same act as changing what every future one
   *  starts from — the same gate the template builder uses. */
  canManageFirmTerms?: boolean;
  /**
   * The firm's standard terms (1610).
   *
   * What makes a from-scratch engagement a real proposal. Every engagement IS a
   * proposal — the founder, on this being template-only: "make it so all
   * engagements are a proposal wtf not only templates?? that would make sense
   * right?" It does. A template supplies richer content (a welcome message, a
   * video, extra signers); without one, the firm's standard terms plus the
   * priced services is still a complete, honest agreement.
   */
  firmDefaultTerms?: string;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  // Scope names live in the Clients namespace, shared with the profile card.
  const tClients = useTranslations("Clients");
  // The Proposal step's labels — period, terms, who signs, deposit — already
  // exist in the Templates namespace, written for the template builder. They
  // are read from there rather than copied here: one label per concept, so the
  // engagement and the template that produced it can never word it differently.
  const tTpl = useTranslations("Templates");

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
  // A saved engagement chosen BEFORE arriving — "Use" on the Templates page,
  // via ?engagement_template=. Matched against the loaded list rather than
  // trusted: a stale id, or one private to somebody else, resolves to undefined
  // and the builder simply opens normally with the start chooser.
  //
  // Its four fields seed the state directly rather than being applied by an
  // effect after mount. A mount effect would have to call four setters — which
  // is a render-then-correct flash, and the React Compiler rejects it outright.
  const initialEngagementTemplate =
    initialEngagementTemplateId != null
      ? engagementTemplates.find((x) => x.id === initialEngagementTemplateId)
      : undefined;
  const seededTitle =
    initialEngagementTemplate?.payload.title.trim() ? initialEngagementTemplate.payload.title : "";

  const [title, setTitle] = useState(seededTitle);
  // Seeded titles count as touched, so the auto-title does not overwrite what
  // the template supplied the moment a client is picked.
  const [titleTouched, setTitleTouched] = useState(seededTitle !== "");
  const [dueDate, setDueDate] = useState("");
  // Canopy's step 1 (migration 1510).
  const [startDate, setStartDate] = useState("");
  const [introMessage, setIntroMessage] = useState("");
  // Empty string = "me", which is what the server already does when no assignee
  // is sent. Naming that explicitly in the picker is clearer than an
  // unlabelled blank option.
  const [assigneeId, setAssigneeId] = useState("");
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
    // A saved engagement's own checklist wins over the document template's:
    // it is the more specific answer, and it is what the person clicking "Use"
    // asked for. Province filtering is deliberately NOT applied to it — those
    // lines were chosen by hand for this kind of work, not generated.
    const fromEngagementTemplate = initialEngagementTemplate?.payload.checklist;
    if (fromEngagementTemplate && fromEngagementTemplate.length > 0) {
      return fromEngagementTemplate.map((c) => ({
        label_en: c.label_en,
        label_fr: c.label_fr,
        description_en: c.description_en ?? "",
        description_fr: c.description_fr ?? "",
        doc_type: c.doc_type ?? null,
        required: c.required,
      })) as TemplateItem[];
    }
    // If we already know the client (e.g. started from a client's page), seed
    // the checklist with only the documents that apply to their province.
    const initialProvince =
      clients.find((c) => c.id === initialClientId)?.province ?? null;
    return (initialTemplate?.items ?? []).filter((it) =>
      templateItemApplies(it, initialProvince, includeQuebecForms),
    );
  });
  const [error, setError] = useState<string | null>(null);
  // Shorthand for the template's payload, since every proposal field now falls
  // back when there isn't one.
  const tpl = initialEngagementTemplate?.payload;

  // ── THE PROPOSAL, EDITABLE ON THE ENGAGEMENT ITSELF ─────────────────────
  //
  // These were template-only, so an engagement built from scratch got defaults
  // it could not change. The founder: "now engagement creation is lacking."
  //
  // Seeded from the template when there is one, from the firm's standard terms
  // when there is not — so the common case is already filled in and the step is
  // a review rather than a form.
  // ── CANOPY'S THREE INTRODUCTION ROWS ────────────────────────────────────
  //
  // The founder: "even, like, the UI choices with, like, for example, like,
  // introduction, like, that's not even a section that's in the engagement
  // creation... There's so much that's in the template engagement creator
  // versus the actual engagement creator. They should be the fucking exact
  // same."
  //
  // They were right. A template could put a welcome note, a video and a
  // brochure at the top of what the client reads; an engagement had a bare
  // textarea and no way to attach either file. Same rows, same toggles, same
  // uploader as the template — seeded from it when one was used.
  //
  // The toggle is kept SEPARATE from the content on purpose: turning Video off
  // and back on must not lose the link you already pasted. That is the
  // difference between a toggle and a delete.
  const [welcomeEnabled, setWelcomeEnabled] = useState(
    tpl?.welcomeEnabled ?? false,
  );
  const [videoEnabled, setVideoEnabled] = useState(tpl?.videoEnabled ?? false);
  const [videoUrl, setVideoUrl] = useState(tpl?.videoUrl ?? "");
  const [videoPath, setVideoPath] = useState(tpl?.videoPath ?? "");
  const [videoFileName, setVideoFileName] = useState(tpl?.videoFileName ?? "");
  const [documentEnabled, setDocumentEnabled] = useState(
    tpl?.documentEnabled ?? false,
  );
  const [documentName, setDocumentName] = useState(tpl?.documentName ?? "");
  const [documentPath, setDocumentPath] = useState(tpl?.documentPath ?? "");

  /** Canopy's Terms tab has an on/off switch; an engagement always showed the
   *  box. On means "this proposal carries terms", which is not the same as
   *  "the box happens to be empty". */
  const [termsEnabled, setTermsEnabled] = useState(tpl?.termsEnabled ?? true);
  const [termsSaved, setTermsSaved] = useState(false);

  // Sections, matching the template builder. Seeded from the template when
  // there is one, from the firm's standard terms when there is not — the same
  // head start the single textarea used to give, in the new shape.
  const [termsSections, setTermsSections] = useState<TermsSection[]>(() => {
    if (tpl && tpl.termsSections.length > 0) return tpl.termsSections;
    return firmDefaultTerms.trim()
      ? [{ heading: "", body: firmDefaultTerms }]
      : [];
  });
  const [proposalPeriodStartsOn, setProposalPeriodStartsOn] = useState<
    "acceptance" | "custom"
  >(tpl?.periodStartsOn ?? "acceptance");
  const [proposalPeriodMonths, setProposalPeriodMonths] = useState<number | null>(
    tpl?.periodMonths ?? null,
  );
  const [proposalClientSigns, setProposalClientSigns] = useState(
    tpl?.clientSigns ?? true,
  );
  const [proposalSigners, setProposalSigners] = useState<string[]>(
    tpl?.additionalSignerLabels ?? [],
  );
  const [proposalFirmCountersigns, setProposalFirmCountersigns] = useState(
    tpl?.firmCountersigns ?? false,
  );
  const [proposalDeposit, setProposalDeposit] = useState(
    tpl?.depositCents != null ? String(tpl.depositCents / 100) : "",
  );

  // Canopy's gear menu on the Services tab: which figures reach the client.
  // Template-only until now, which meant an engagement could not hide a rate
  // the template it came from was hiding.
  const [priceVisibility, setPriceVisibility] = useState<PriceVisibility>(
    tpl?.priceVisibility ?? defaultPriceVisibility(),
  );
  // Canopy's Payment settings: the client saves a card on acceptance so a
  // recurring invoice can be charged without asking again.
  /** Who settles the deposit — the client by default, or one of the named
   *  signer roles. Canopy asks this; we were not asking at all. */
  const [proposalPayer, setProposalPayer] = useState("");
  const [requirePaymentMethod, setRequirePaymentMethod] = useState(
    tpl?.requirePaymentMethod ?? false,
  );

  const proposalDepositCents = useMemo(() => {
    const n = Number(proposalDeposit.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }, [proposalDeposit]);

  // ── THE SAME EDITOR THE TEMPLATE'S SERVICES TAB USES ──────────────────
  //
  // The founder: "the service page has alot more detail and understanding
  // compared to the service page on the engagement creation too. Cmon i though
  // you fixed that."
  //
  // Fair. Price visibility, payment settings and the totals came across; the
  // BLOCKS did not, so a template could say "one-time, due on acceptance,
  // shown to the client as one line" and an engagement could only say "here is
  // a list of lines".
  //
  // Blocks are the AUTHORING shape and flatten into the flat `service_items`
  // everything downstream already reads — so this changes what you can express,
  // not what gets stored. This builder only ever CREATES (there is no edit
  // route), which is why the blocks can live in state and flatten on save.
  const [blocks, setBlocks] = useState<BillingBlock[]>(() => {
    const fromTemplate = initialEngagementTemplate?.payload.billingBlocks ?? [];
    if (fromTemplate.length > 0) return fromTemplate;
    // A template written before blocks existed carries a flat list. It becomes
    // ONE one-time block rather than nothing, so its prices survive.
    const flat = initialEngagementTemplate?.payload.items ?? [];
    return flat.length > 0
      ? [{ ...emptyBlock("one_time"), items: flat }]
      : [emptyBlock("one_time")];
  });

  /** What everything downstream reads: totals, the proposal, the save. Derived
   *  so there is one source of truth and the two can never disagree. */
  const serviceItems = useMemo(() => flattenBlocks(blocks), [blocks]);

  // What the work CONSISTS OF (1370's engagement_tasks).
  //
  // ── STARTS EMPTY ────────────────────────────────────────────────────────
  //
  // The founder: "everytime you create an engagement automatically on the tasks
  // tab it already has document request pre selected. IT SHOULDNT. It should
  // just be empty (for engagements starting from scratch obviously)."
  //
  // It used to seed a document-collection row on every engagement, on the
  // reasoning that every engagement in Vylan had a checklist before this step
  // existed. That reasoning aged out: an engagement is a proposal now, and
  // plenty of them ask the client for nothing at all. A row nobody asked for is
  // a row somebody has to notice and delete.
  //
  // A TEMPLATE still brings whatever it carries — that is the whole point of
  // picking one, and the founder's "obviously" is doing that work in their
  // sentence.
  const [tasks, setTasks] = useState<TaskDraft[]>(() => {
    let next: TaskDraft[] = [];

    // A template that asks the client for documents needs somewhere to put
    // them: the checklist hangs off a document-collection task. Added only
    // when the template actually carries requests, never speculatively.
    if ((initialEngagementTemplate?.payload.checklist.length ?? 0) > 0) {
      next = [
        { ...emptyTask("document_collection"), title: t("task_seed_documents") },
      ];
    }

    // ── THE TEMPLATE'S WORK ─────────────────────────────────────────────
    //
    // An engagement built from a template used to arrive with the priced lines
    // and the document requests, and NO tasks — the template stored which work
    // its services implied (1620) and nothing read it back. So the whole point
    // of linking a service to a task template stopped at the template.
    //
    // Seeded in the initial state rather than by an effect: a mount effect that
    // called setTasks would render the empty list first and correct it a frame
    // later, which reads as the page losing your work. React Compiler rejects
    // it too.
    for (const id of initialEngagementTemplate?.payload.taskTemplateIds ?? []) {
      const tt = taskTemplates.find((x) => x.id === id);
      if (!tt) continue; // A deleted template simply produces no tasks.
      next = appendTaskTemplate(
        next,
        { name: tt.name, kind: tt.kind, subtasks: tt.subtasks },
        // No source label: the template brought this, not a service picked on
        // this screen. Labelling it with a service name would be a lie, and
        // pullServiceWork uses that label to avoid adding the same work twice.
      ).tasks;
    }
    return next;
  });
  const docTaskIndex = documentCollectionIndex(tasks);

  function updateTask(idx: number, patch: Partial<TaskDraft>) {
    setTasks((prev) =>
      prev.map((task, i) => (i === idx ? { ...task, ...patch } : task)),
    );
  }
  function addTask() {
    setTasks((prev) => [...prev, emptyTask()]);
  }
  function removeTask(idx: number) {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  }
  // Which rows a just-applied template had to change, so the step can say so.
  // Cleared on the next apply — it describes ONE action, not a running tally.
  const [downgradedTasks, setDowngradedTasks] = useState<string[]>([]);
  function applyTaskTemplate(id: string) {
    const tpl = taskTemplates.find((x) => x.id === id);
    if (!tpl) return;
    const res = appendTaskTemplate(tasks, {
      name: tpl.name,
      kind: tpl.kind,
      subtasks: tpl.subtasks,
    });
    setTasks(res.tasks);
    setDowngradedTasks(res.downgraded);

    // A task template can carry the CLIENT REQUEST its document-collection task
    // asks for (Canopy's "Add client request"). Bring it across — a template
    // that says "collect these six documents" and then collects none of them
    // has done half its job.
    //
    // ONLY WHEN THE CHECKLIST IS STILL EMPTY. Overwriting would throw away
    // lines already typed by hand, and appending would duplicate them on a
    // second apply. Leaving a filled checklist alone is the one option that
    // cannot lose anything the accountant did.
    if (items.length === 0) {
      const carried = tpl.checklist;
      if (carried && carried.length > 0) {
        setItems(
          carried.map((c) => ({
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
  }
  /**
   * Bring in the work a picked service implies (1620).
   *
   * Goes through appendTaskTemplate for the same reason applying a template by
   * hand does: two services can both carry a document-collection task, and an
   * engagement holds only one. The second lands as a plain task and the step
   * says so, rather than the insert failing silently the way a fail-soft write
   * would.
   *
   * Idempotent by SOURCE: picking the same service twice, or re-picking it on
   * another line, must not stack duplicate tasks.
   */
  function pullServiceWork(service: {
    name: string;
    work?: { templateId: string; name: string; kind: string; stepCount: number } | null;
  }) {
    const work = service.work;
    if (!work) return;
    const tpl = taskTemplates.find((x) => x.id === work.templateId);
    if (!tpl) return;
    setTasks((prev) => {
      if (prev.some((x) => x.sourceLabel === service.name)) return prev;
      const res = appendTaskTemplate(
        prev,
        { name: tpl.name, kind: tpl.kind, subtasks: tpl.subtasks },
        service.name,
      );
      if (res.downgraded.length > 0) setDowngradedTasks(res.downgraded);
      return res.tasks;
    });
  }

  function moveTask(idx: number, delta: number) {
    setTasks((prev) => {
      const to = idx + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }

  const [rawStep, setRawStep] = useState<WizardStep>("details");
  const step = rawStep;

  /**
   * Moving between steps writes a history entry, so the browser's own back and
   * forward buttons walk the wizard — the founder: "the back and forth buttons
   * should be linked to browser back and forth buttons."
   *
   * history.pushState directly rather than the Next router: this is a modal
   * whose state lives in this component, and a router navigation would re-run
   * the server component for a change that is purely local. pushState moves the
   * URL and nothing else.
   */
  function setStep(next: WizardStep) {
    setRawStep((prev) => {
      if (prev !== next && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("step", next);
        window.history.pushState({ vylanStep: next }, "", url);
      }
      return next;
    });
  }

  useEffect(() => {
    // Back/forward: read the step out of the URL the browser just restored.
    // Anything unrecognised falls back to the first step rather than throwing —
    // a hand-edited URL must not break the form.
    function onPop() {
      const raw = new URL(window.location.href).searchParams.get("step");
      setRawStep(
        (WIZARD_STEPS as readonly string[]).includes(raw ?? "")
          ? (raw as WizardStep)
          : "details",
      );
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
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
    // Blocks when the template has them, otherwise its flat lines become one
    // one-time block — the same upgrade the initial state does, because a
    // template picked here and a template picked on arrival must land
    // identically.
    if (p.billingBlocks.length > 0) {
      setBlocks(p.billingBlocks);
    } else if (p.items.length > 0) {
      setBlocks([{ ...emptyBlock("one_time"), items: p.items }]);
    }
    if (p.priceVisibility) setPriceVisibility(p.priceVisibility);
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
  //
  // ?engagement_template= is the ONE deep link that DOES skip it: it answers
  // the chooser's own question. Its payload is already seeded into state above,
  // so skipping the chooser shows a form that is filled in, not a blank one.
  const [started, setStarted] = useState(initialEngagementTemplate != null);

  // A tick means "this step has what it NEEDS", not "you have been here".
  // Rewarding a visit would put a tick on an empty Documents step, which is the
  // one thing that actually blocks sending.
  const stepComplete: Record<WizardStep, boolean> = {
    details: clientId != null && title.trim().length > 0,
    // Optional on purpose. An engagement with no priced scope is exactly what
    // every engagement in Vylan was until now, and refusing to send one would
    // break the existing flow for a field nobody has filled in yet.
    services: true,
    // Titled work, or a checklist with something in it. Either alone is a real
    // answer: "meet the client, then file" needs no documents, and a plain
    // document request needs no other task.
    tasks:
      meaningfulTasks(tasks).length > 0 || items.length > 0,
    // Money and chasing are genuinely optional — a draft with neither is a
    // valid engagement — so they are complete by definition. They still get a
    // tick rather than nothing, because an empty circle beside a step you were
    // never required to fill reads as an error.
    billing: true,
    reminders: true,
    // Always ticked: an engagement with no terms and nobody signing is still a
    // valid engagement — plenty of firms send work without a formal agreement,
    // and refusing to let them would break the existing flow.
    proposal: true,
  };
  // How many times "Create and send" was pressed with an empty checklist.
  // From the 2nd attempt we ring the checklist so the reason is obvious.
  const [pending, startTransition] = useTransition();
  // The wizard's ✕ and Esc both close by NAVIGATING — this screen is a route,
  // not a mounted dialog, which is the decision three lag bugs were fixed by.
  const router = useRouter();

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

  /** What the client will see, from the form as it stands. ONE builder for it,
   *  used by both the preview on this step and the snapshot written on save —
   *  two copies would drift and the preview would start lying. */
  //
  // Computed plainly, NOT memoized: React Compiler refuses to preserve a manual
  // memo whose deps it thinks may be mutated, and one already exists in this
  // component — a second would add an error without changing the outcome. It is
  // a handful of maps over a list that is never long.
  // Plain, not memoized: this component already carries a manual memo the React
  // Compiler refuses to preserve, so a second adds an error without changing the
  // outcome. It is a couple of passes over a list that is never long.
  const billingTotals = computeBillingTotals(serviceItems, {
    depositCents: proposalDepositCents,
  });

  const proposalData = {
    clientName: selectedClient?.display_name ?? t("preview_no_client"),
    engagementName: resolvePlaceholders(
      effectiveTitle.trim(),
      {
        clientName: selectedClient?.display_name ?? null,
        taxYear: taxYear ? Number(taxYear) : null,
      },
      new Date(),
      locale,
    ),
    periodStartsOn: proposalPeriodStartsOn,
    periodMonths: proposalPeriodMonths,
    welcome: welcomeEnabled ? introMessage.trim() || null : null,
    videoUrl: videoEnabled ? videoUrl.trim() || null : null,
    documentName: documentEnabled ? documentName.trim() || null : null,
    videoPath: videoEnabled ? videoPath || null : null,
    documentPath: documentEnabled ? documentPath || null : null,
    // Each priced line carries the work it brings, so the client reads what
    // they are buying rather than only what it costs. Matched by SERVICE, which
    // is the link the catalogue actually stores (1620) — the tasks on the Tasks
    // step may since have been edited, and the contract should describe the
    // offer, not somebody's in-progress checklist.
    services: serviceItems
      .filter((i) => i.name.trim().length > 0)
      .map((i) => {
        const svc = i.serviceId
          ? services.find((x) => x.id === i.serviceId)
          : undefined;
        const tt = svc?.work
          ? taskTemplates.find((x) => x.id === svc.work!.templateId)
          : undefined;
        return {
          name: i.name.trim(),
          rateCents: i.rateCents,
          work: tt?.subtasks.map((x) => x.title),
          // So the client's own copy totals itself the same way this screen
          // does, rather than trusting a number we computed for them.
          billingFrequency: i.billingFrequency,
          taxPct: i.taxPct,
        };
      }),
    termsSections: termsEnabled ? termsSections : [],
    clientSigns: proposalClientSigns,
    additionalSignerLabels: proposalSigners.map((x) => x.trim()).filter(Boolean),
    firmCountersigns: proposalFirmCountersigns,
    depositCents: proposalDepositCents,
    priceVisibility,
  };

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
  // COPIED, not shared. The editor mutates this list; handing it the prop's own
  // array would let editing a draft engagement reach back into the template
  // object the page loaded.


  // An empty checklist is no longer an error, so nothing needs ringing: an
  // engagement that asks the client for nothing is an ordinary engagement.
  const highlightEmptyChecklist = false;

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

  async function submit(
    send: boolean,
    /** Canopy's "Accept proposal": record that the client already agreed and
     *  set the engagement live, in the same save. */
    acceptOnBehalf = false,
  ) {
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

    // NO documents gate — the founder: "its entirely possible for an
    // engagement to exist that doesnt require documents to be uploaded." An
    // empty checklist used to block Send on the reasoning that the client would
    // land on an empty portal; what they land on now is the proposal.

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
      invoiceMode === "on_acceptance" ||
      invoiceMode === "on_completion" ||
      invoiceMode === "delayed"
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
            // Resolved at SAVE, not as you type. Typing must leave the token
            // visible so it is obvious the name is dynamic; a name that
            // silently rewrote itself mid-keystroke would be unusable. An
            // unknown value leaves its token, so a saved name is never a
            // half-finished sentence.
            title: resolvePlaceholders(
              effectiveTitle.trim(),
              {
                clientName: selectedClient?.display_name ?? null,
                taxYear: taxYear ? Number(taxYear) : null,
              },
              new Date(),
              locale,
            ),
            type: selectedTemplate.type,
            due_date: dueDate || null,
            start_date: startDate || null,
            assigned_user_id: assigneeId || null,
            intro_message: introMessage.trim() || null,
            // Which document template the checklist came from (1560): the
            // engagement's workflow snapshot copies THAT template's flow —
            // the customized one, not the family default.
            template_id: selectedTemplate.id,
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
            // What the work consists of. Titled rows only — an untitled row
            // left over from a stray "+ Add task" click must not land on the
            // engagement as a nameless entry.
            // ── THE PROPOSAL, FROZEN (1660) ──────────────────────────────
            // Built from the engagement template this started from, because
            // that is the only place terms, the welcome message and the
            // signature block exist. Sent as a SNAPSHOT so a client who agrees
            // in February keeps holding what they agreed to after the firm
            // edits its standard terms in March.
            //
            // Absent when the engagement did not come from a template — there
            // is nothing to show, and the portal falls back to its normal view
            // rather than presenting a blank page with an Accept button.
            // The SAME object the preview on the Proposal step renders, so
            // what the accountant reviewed is exactly what gets frozen. The
            // client's name is dropped: the snapshot reader takes it from the
            // engagement's own client, so a renamed client still reads
            // correctly on their own document.
            // Its own field as well as the frozen proposal (1680): the
            // snapshot is what the client READS, this is what gets CHARGED.
            deposit_cents: proposalDepositCents,
            proposal: {
              ...proposalData,
              // The snapshot reader takes the client's name from the
              // engagement's own client, so a renamed client still reads
              // correctly on their own document. Storing it here would freeze
              // yesterday's name onto the contract.
              clientName: undefined,
            },
            tasks: meaningfulTasks(tasks).map((task) => ({
              title: task.title,
              kind: task.kind,
              assignee_ids: task.assigneeIds,
              // The steps under it. Written as child rows via parent_id.
              subtasks: task.subtasks ?? [],
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
            accept_on_behalf: acceptOnBehalf,
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
      billingBlocks: blocks,
      priceVisibility,
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
    <>
    <SaveAsTemplateDialog
      open={savingTemplate}
      onOpenChange={setSavingTemplate}
      payload={currentTemplatePayload()}
      suggestedName={title.trim()}
    />

    {/* ── THE SAME CHROME AS EVERY TEMPLATE BUILDER ────────────────────
        The founder: "the engagement creation ui is still lacking. IT still has
        that Vylan UI look not the canopy Ui look that you can see on the
        template builders. I want the same feel on engagement creation."

        So this is TemplateBuilderShell — the identical steps box, green
        checkmarks, progress bar, preview card and Back/Continue footer the four
        template builders wear. Not a copy of them: the same component, so the
        next change to how a builder looks reaches this screen without anyone
        remembering to come here. That is the handoff's line too: "identical
        panels to the engagement template — that is the point: same rooms, same
        furniture."

        EngagementModalShell is gone from this path. It drew its own overlay,
        title bar and save dropdown, and the wizard draws all three — keeping it
        would have meant two backdrops and two save controls. The opening
        "start from a template?" question still uses it, because that screen is
        a question and not a wizard. */}
    <TemplateBuilderShell
      kicker={t("kicker_engagement")}
      title={t("new_title")}
      explainer={t("wizard_explainer")}
      tabs={WIZARD_STEPS.map((k): BuilderTab => ({
        key: k,
        label: t(`wizard_step_${k}` as WizardStepKey),
        description: t(`wizard_step_desc_${k}` as WizardStepDescKey),
        // The red mark means "required and not answered yet" — the same thing
        // the rail's asterisk-plus-empty-circle used to say, in the template
        // builders' vocabulary. Only the two that actually stop you sending.
        incomplete: (k === "details" || k === "tasks") && !stepComplete[k],
      }))}
      activeTab={step}
      onTabChange={(k) => setStep(k as WizardStep)}
      onClose={() => router.push("/engagements")}
      // Save draft keeps a half-finished engagement; Save as template keeps its
      // SHAPE. Both were in the old split button, and both survive — they are
      // the two ways of leaving this screen without sending, and the handoff's
      // header (one outline button + ✕) has room for them.
      headerActions={[
        {
          label: pending ? tc("saving") : t("save_draft"),
          variant: "outline" as const,
          disabled: pending,
          onClick: () => submit(false),
        },
        {
          label: t("save_as_template"),
          variant: "ghost" as const,
          disabled: pending,
          onClick: () => setSavingTemplate(true),
        },
      ]}
      // On the Proposal step — the last one — Continue becomes the send. It is
      // the only thing left to do there, and a greyed-out Next said nothing.
      finalAction={{
        label: t("create_and_send"),
        disabled: pending,
        onClick: () => submit(true),
      }}
      previewLabel={
        selectedClient
          ? t("preview_for_client", { name: selectedClient.display_name })
          : tTpl("preview_sample_label")
      }
      // ── THE PROPOSAL, ON EVERY STEP ─────────────────────────────────
      // Founder: "Put the preview that you see on proposal appear throughout
      // the entire engagement creation process."
      //
      // It is the same component the client opens, so every step now shows
      // what your edits are doing to the document they will read. The step it
      // highlights follows where you are working.
      preview={
        <div className="mx-auto w-full max-w-md space-y-4">
          <ProposalPreview
            data={proposalData}
            locale={locale}
            activeStep={PREVIEW_STEP_FOR[step]}
          />

          {/* ── CANOPY'S ACCEPT CARD ────────────────────────────────────
              The founder, with Canopy's screenshot: "supposedly you built a
              way to accept proposals on the behalf of the client. Where is
              it... REPLICATE IT."

              It WAS built — as a button on the engagement's own page, and only
              once the engagement had been sent. So it was invisible from the
              place you would look for it and from every engagement that had
              not been sent yet. Canopy puts it in the builder, always
              reachable, and they are right: the common case is a firm who
              already has the client's yes and just wants the job set up.

              Recorded as accepted_by = 'firm', never 'client' — a note that an
              agreement was given, not a signature. */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm leading-relaxed">
              {t("accept_on_behalf_card")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={pending || !clientId}
              onClick={() => submit(false, true)}
            >
              {t("accept_proposal")}
            </Button>
            {/* Says WHY it is unavailable rather than sitting greyed out with
                no explanation — the founder has been caught by a dead control
                before. */}
            {!clientId && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("accept_on_behalf_needs_client")}
              </p>
            )}
          </div>
        </div>
      }
    >
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
              <CardTitle className="text-base">{t("section_details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="title">{t("field_title")}</Label>
                  {/* Canopy's + on the name field. Inserts a token rather than
                      a value, so the same name works for every client the
                      template is later used on — which is the whole reason a
                      saved template can carry a name at all. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Plus className="size-3" aria-hidden />
                        {t("placeholder_add")}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {PLACEHOLDERS.map((token) => (
                        <DropdownMenuItem
                          key={token}
                          onSelect={() => {
                            // Appended, not inserted at the caret: reading the
                            // caret out of a controlled input reliably is more
                            // machinery than this earns, and appending is what
                            // you want when naming something anyway.
                            setTitle(
                              (prev) =>
                                `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${placeholderText(token)}`,
                            );
                            setTitleTouched(true);
                          }}
                        >
                          {t(`placeholder_${token}` as PlaceholderKey)}
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                            {placeholderText(token)}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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
              {/* START date — Canopy's step 1 has both, and they answer
                  different questions: when the work BEGINS versus when it is
                  OWED. Conflating them is why an engagement created in advance
                  for next season had no honest way to say it had not started. */}
              <div className="space-y-1.5">
                <Label htmlFor="start_date">{t("field_start_date")}</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-fit"
                />
                <p className="text-xs text-muted-foreground">
                  {t("start_date_hint")}
                </p>
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
              {/* WHO the work belongs to, from the moment it exists. The save
                  path has accepted this since 0001; the form never offered it,
                  so handing work to somebody else was always TWO steps —
                  create it, then reassign. Hidden in a solo firm: a picker with
                  one option is a question with one answer. */}
              {members.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="assignee">{t("field_assignee")}</Label>
                  <select
                    id="assignee"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="h-9 w-fit min-w-[14rem] rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">{t("assignee_me")}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* ── CANOPY'S THREE INTRODUCTION ROWS ─────────────────────
                  Identical to the template builder's Introduction tab: the
                  same ToggleRow, the same uploader, the same copy. It was a
                  bare textarea with no video and no document at all.

                  PLAIN TEXT for the note: nothing in this repo has a rich-text
                  editor, and adding one is its own decision. Storing text now
                  and upgrading the EDITOR later is safe; storing HTML from an
                  editor that does not exist is not. */}
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {tTpl("tab_introduction")}
                </p>
                <ToggleRow
                  label={tTpl("welcome_message")}
                  hint={tTpl("welcome_message_hint")}
                  on={welcomeEnabled}
                  onToggle={() => setWelcomeEnabled((v) => !v)}
                >
                  <Textarea
                    id="intro_message"
                    value={introMessage}
                    onChange={(e) => setIntroMessage(e.target.value)}
                    placeholder={t("intro_message_placeholder")}
                    rows={4}
                  />
                </ToggleRow>
                <ToggleRow
                  label={tTpl("intro_video")}
                  hint={tTpl("intro_video_hint")}
                  on={videoEnabled}
                  onToggle={() => setVideoEnabled((v) => !v)}
                >
                  <div className="space-y-2">
                    <Input
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder={tTpl("intro_video_placeholder")}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {tTpl("or_upload")}
                    </p>
                    <AssetUpload
                      kind="video"
                      fileName={videoFileName}
                      onUploaded={(path, name) => {
                        setVideoPath(path);
                        setVideoFileName(name);
                      }}
                      onClear={() => {
                        setVideoPath("");
                        setVideoFileName("");
                      }}
                    />
                  </div>
                </ToggleRow>
                <ToggleRow
                  label={tTpl("intro_document")}
                  hint={tTpl("intro_document_hint")}
                  on={documentEnabled}
                  onToggle={() => setDocumentEnabled((v) => !v)}
                >
                  <AssetUpload
                    kind="document"
                    fileName={documentName}
                    onUploaded={(path, name) => {
                      setDocumentPath(path);
                      setDocumentName(name);
                    }}
                    onClear={() => {
                      setDocumentPath("");
                      setDocumentName("");
                    }}
                  />
                </ToggleRow>
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
            <BillingBlocksEditor
              blocks={blocks}
              onChange={setBlocks}
              visibility={priceVisibility}
              onVisibilityChange={setPriceVisibility}
              // A service that carries work brings it. Automatic, per the
              // founder — no prompt; the tasks land in the Tasks step labelled
              // with the service that brought them, and are edited or deleted
              // there like any other.
              onServicePicked={pullServiceWork}
              locale={locale}
              services={services}
              // No firm-wide default tax on this screen — the builder is given
              // service PRICES, not a rate. Lines take their tax from the
              // catalogue service or from what you type.
              fallbackTaxPct={null}
            />
          </CardContent>
        </Card>
      )}

      {/* The document-request template picker, MOVED HERE from step 1.
          Founder: "why am I still being prompted to take a document collection
          template at the beginning of an engagement? wouldn't it only be
          prompted once I choose that I want to collect documents?"
          
          Right. It sat in Engagement details because it is a leftover from when
          the engagement WAS its checklist — picking a template defined the
          whole thing, so it belonged at the front. Now that Documents is its
          own step, a picker for document requests belongs in it, and step 1 is
          what Canopy's is: who it is for and what it is called. */}
      {step === "tasks" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("section_tasks")}{" "}
              <span className="font-normal text-muted-foreground">
                ({tasks.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Says what the template could not bring across, rather than
                letting a row quietly arrive as the wrong kind. An engagement
                holds one document request, one signature step and one set of
                deliverables (1370), so a template carrying a second lands as a
                plain task — visible, and one dropdown away from being fixed. */}
            {downgradedTasks.length > 0 && (
              <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("task_template_downgraded", {
                  titles: downgradedTasks.join(", "),
                })}
              </p>
            )}
            {tasks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("tasks_empty")}
              </div>
            ) : (
              <ul className="space-y-3">
                {tasks.map((task, idx) => (
                  <li
                    key={idx}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col items-center pt-1 text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => moveTask(idx, -1)}
                          disabled={idx === 0}
                          className="hover:text-foreground disabled:opacity-30"
                          aria-label={t("move_up")}
                        >
                          ↑
                        </button>
                        <GripVertical className="size-3" aria-hidden />
                        <button
                          type="button"
                          onClick={() => moveTask(idx, 1)}
                          disabled={idx === tasks.length - 1}
                          className="hover:text-foreground disabled:opacity-30"
                          aria-label={t("move_down")}
                        >
                          ↓
                        </button>
                      </div>
                      <div className="flex-1 space-y-2">
                        <Input
                          value={task.title}
                          onChange={(e) =>
                            updateTask(idx, { title: e.target.value })
                          }
                          placeholder={t("task_title_placeholder")}
                          aria-label={t("task_title_placeholder")}
                        />
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          {/* Only kinds this engagement can still take: the
                              three screen-backed ones are one-per-job (1370's
                              partial unique index), and offering a second would
                              offer a row the insert will refuse. */}
                          <select
                            value={task.kind}
                            onChange={(e) =>
                              updateTask(idx, {
                                kind: e.target.value as TaskKind,
                              })
                            }
                            aria-label={t("task_kind_label")}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            {availableKinds(tasks, idx).map((kind) => (
                              <option key={kind} value={kind}>
                                {t(taskKindLabelKey(kind) as "kind_task")}
                              </option>
                            ))}
                          </select>
                          {/* Hidden in a solo firm — there is nobody else to
                              hand it to, so the control would be a dead end. */}
                          {members.length > 0 && (
                            <select
                              value={task.assigneeIds[0] ?? ""}
                              onChange={(e) =>
                                updateTask(idx, {
                                  assigneeIds: e.target.value
                                    ? [e.target.value]
                                    : [],
                                })
                              }
                              aria-label={t("task_assignee_label")}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            >
                              <option value="">{t("task_assignee_none")}</option>
                              {members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          )}
                          {task.kind === "document_collection" && (
                            <span className="text-muted-foreground">
                              {t("task_documents_count")}: {items.length}
                            </span>
                          )}
                          {/* Steps arrive with a task template. Shown as a
                              count rather than a list: the row is one line and
                              five step names would wrap it into four. */}
                          {task.sourceLabel && (
                            <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-accent">
                              {t("task_from_service", { name: task.sourceLabel })}
                            </span>
                          )}
                          {(task.subtasks?.length ?? 0) > 0 && (
                            <span className="text-muted-foreground">
                              {t("task_steps_count", {
                                count: task.subtasks?.length ?? 0,
                              })}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeTask(idx)}
                            className="ml-auto inline-flex items-center gap-1 text-destructive hover:underline"
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

            {/* ── THE ADD CONTROLS SIT UNDER THE LIST ──────────────────────
                Canopy puts "+ Add task template" beneath the box of rows, not
                in the header beside the title — you read what is there, then
                add to the end of it. The founder, with their screenshot: "move
                the Apply task template button below the task like box... it
                sits below the actual box in the canopy screenshot."

                The header keeps only the heading and the count. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={addTask}>
                <Plus className="size-4" />
                {t("add_task")}
              </Button>
              {/* Hidden when the firm has none — a dropdown whose only entry is
                  its own placeholder is a control that does nothing. */}
              {taskTemplates.length > 0 && (
                <select
                  // Reset to "" after every apply, so applying the SAME template
                  // twice works. A <select> whose value already equals the
                  // chosen option fires no change event, which would read as
                  // the second click doing nothing.
                  value=""
                  onChange={(e) => {
                    if (e.target.value) applyTaskTemplate(e.target.value);
                  }}
                  aria-label={t("apply_task_template")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">{t("apply_task_template")}</option>
                  {taskTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── BELONGS TO THE DOCUMENT-COLLECTION TASK ABOVE ──────────────────
          Present only because that task is, and gone the moment it is deleted.
          This is the founder's correction in structural form: a document
          request template is not a section of engagement creation, it is how
          you fill in ONE task. */}
      {step === "tasks" && docTaskIndex !== -1 && (
        <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("section_template")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  role="radiogroup"
                  aria-label={t("section_template")}
                  // ONE column of rows, not a three-across grid. This picker
                  // lives in a modal beside a live preview, so the grid gave
                  // each card about 180px and every name arrived truncated —
                  // "New ...", "Trust...", "T1 Pe...". Rows fit the column and
                  // show the whole name.
                  className="max-h-[22rem] space-y-2 overflow-y-auto pr-1"
                >
                  {orderedTemplates.map((tmpl) => (
                    <SelectableTemplateCard
                      key={tmpl.id}
                      layout="row"
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
        </>
      )}

      {/* The checklist itself — also the document task's, on the same terms. */}
      {step === "tasks" && docTaskIndex !== -1 && (
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

      {/* The scope, priced and grouped by how often each line is billed —
          Canopy's totals panel, and the thing that makes this step legible:
          "what does this client owe, and how often" cannot be read off a flat
          list of mixed frequencies.

          REUSED, not rebuilt. Another session wrote this panel for the
          engagement detail page and it does exactly this job; a second copy is
          the drift CLAUDE.md's cohesion rule exists to stop, and it would be
          worse than usual here because these numbers are what a client agrees
          to pay. It is read-only in both places — the EDITOR is step 2. */}
      {step === "billing" && serviceItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("details_services")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EngagementServicesPanel items={serviceItems} locale={locale} />
          </CardContent>
        </Card>
      )}

      {/* ── WHAT IT ALL COMES TO ─────────────────────────────────────────
          Canopy's totals readout, which Vylan had nowhere at all — the founder:
          "Theres no screen or way to view pricing and stuff like fully."

          The SAME component the template builder's Services tab renders, from
          the same computeBillingTotals, so the two can never disagree about
          what a set of lines adds up to. */}
      {step === "billing" && billingTotals.groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("totals_section")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BillingTotalsPanel totals={billingTotals} locale={locale} />
          </CardContent>
        </Card>
      )}

      {/* ── WHAT THE CLIENT SEES, AND HOW THEY PAY ───────────────────────
          Canopy's "Hide itemized rates on the proposal" plus their Payment
          settings block. The deposit lives HERE now rather than on the
          Proposal step: it is money, it belongs with the money, and having it
          in two conceptual places is how the two drift. */}
      {step === "billing" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("payment_settings")}</CardTitle>
          </CardHeader>
          {/* ── ONE COLUMN, ONE RHYTHM ───────────────────────────────────
              Canopy's Payment settings card: a checkbox, a labelled amount,
              and who pays it — every label at the same left edge, one gap
              between rows, no rules cutting the card into pieces.

              Ours had a stray divider under the heading, a second one between
              the two controls, and an amount box floating at half width. The
              founder: "clean up the billing screen its completely
              misalligned." */}
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={requirePaymentMethod}
                  onChange={(e) => setRequirePaymentMethod(e.target.checked)}
                />
                {t("require_payment_method")}
              </label>
              <p className="pl-6 text-[11px] leading-relaxed text-muted-foreground">
                {t("require_payment_method_hint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="engagement-deposit" className="text-sm">
                {tTpl("require_deposit")}
              </Label>
              <MoneyInput
                id="engagement-deposit"
                valueCents={proposalDepositCents}
                onChangeCents={(cents) =>
                  setProposalDeposit(cents == null ? "" : String(cents / 100))
                }
                placeholder={tTpl("deposit_placeholder")}
                className="max-w-[16rem]"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {tTpl("require_deposit_hint")}
              </p>
            </div>

            {/* Canopy's "Signer responsible for making payment". Only when a
                deposit is actually being asked for — naming a payer for an
                amount of nothing is a control with no question behind it. */}
            {proposalDepositCents != null && (
              <div className="space-y-1.5">
                <Label htmlFor="engagement-payer" className="text-sm">
                  {t("signer_pays_label")}
                </Label>
                <select
                  id="engagement-payer"
                  value={proposalPayer}
                  onChange={(e) => setProposalPayer(e.target.value)}
                  className="h-9 w-full max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{t("signer_pays_client")}</option>
                  {proposalSigners
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </CardContent>
        </Card>
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
                      <SelectItem value="on_acceptance">
                        {t("invoice_mode_on_acceptance")}
                      </SelectItem>
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


      {/* STEP 5 — THE AGREEMENT ITSELF.
          Every engagement carries a proposal now, not just the ones built from
          a template — the founder: "make it so all engagements are a proposal
          wtf not only templates". These fields used to exist ONLY on a
          template, which meant an engagement built from scratch got defaults it
          could not see, let alone change. */}
      {step === "proposal" && (
        <>
            {/* ── WHEN IT RUNS ─────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {tTpl("period_label")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["acceptance", "custom"] as const).map((value) => (
                    <RadioCard
                      key={value}
                      name="engagement-period-start"
                      checked={proposalPeriodStartsOn === value}
                      onSelect={() => setProposalPeriodStartsOn(value)}
                      caption={tTpl("period_begins_on")}
                      label={
                        value === "acceptance"
                          ? tTpl("period_acceptance")
                          : tTpl("period_custom_date")
                      }
                    />
                  ))}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-center">
                  <Label
                    htmlFor="engagement-period"
                    className="text-xs text-muted-foreground"
                  >
                    {tTpl("period_label")}
                  </Label>
                  <select
                    id="engagement-period"
                    value={
                      proposalPeriodMonths == null
                        ? ""
                        : String(proposalPeriodMonths)
                    }
                    onChange={(e) =>
                      setProposalPeriodMonths(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    className="h-9 max-w-sm rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {PERIOD_OPTIONS.map((months) => (
                      <option
                        key={months ?? "ongoing"}
                        value={months == null ? "" : String(months)}
                      >
                        {months == null
                          ? tTpl("period_ongoing")
                          : tTpl("period_months", { count: months })}
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* ── THE TERMS ────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <ScrollText
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  {tTpl("general_terms")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* The SAME editor and the SAME two buttons as the template
                    builder's Terms tab — labelled sections, not one box.
                    The founder: "you can create boxes and label them
                    differently." */}
                <ToggleRow
                  label={tTpl("general_terms")}
                  hint={tTpl("general_terms_hint")}
                  on={termsEnabled}
                  onToggle={() => setTermsEnabled((v) => !v)}
                >
                  <TermsSectionsEditor
                    sections={termsSections}
                    onChange={setTermsSections}
                    actions={
                      <>
                        {firmDefaultTerms.trim() &&
                          !termsSections.some(
                            (x) => x.body.trim() === firmDefaultTerms.trim(),
                          ) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setTermsSections((prev) => [
                                  ...prev,
                                  { heading: "", body: firmDefaultTerms },
                                ])
                              }
                            >
                              {tTpl("use_firm_terms")}
                            </Button>
                          )}
                        {/* Gated: writing terms on ONE engagement is not the
                            same act as changing what every future one starts
                            from. */}
                        {canManageFirmTerms &&
                          termsToPlainText(termsSections).trim() &&
                          termsToPlainText(termsSections).trim() !==
                            firmDefaultTerms.trim() && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  const res = await saveFirmDefaultTermsAction({
                                    terms: termsToPlainText(termsSections).trim(),
                                  });
                                  setTermsSaved(res.ok);
                                })
                              }
                            >
                              {tTpl("save_as_firm_terms")}
                            </Button>
                          )}
                        {termsSaved && (
                          <span className="text-[11px] text-muted-foreground">
                            {tTpl("firm_terms_saved")}
                          </span>
                        )}
                      </>
                    }
                  />
                </ToggleRow>
              </CardContent>
            </Card>

            {/* ── WHO SIGNS ────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <FileSignature
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  {tTpl("who_signs")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* NOT tTpl("who_signs_hint") — that one says "a template
                    names the ROLES that sign, not the people", which is false
                    on this screen. Here you are naming them for a real job. */}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("proposal_who_signs_hint")}
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={proposalClientSigns}
                    onChange={(e) => setProposalClientSigns(e.target.checked)}
                  />
                  {tTpl("signer_client")}
                </label>

                {proposalSigners.map((label, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={label}
                      onChange={(e) =>
                        setProposalSigners((prev) =>
                          prev.map((x, i) => (i === idx ? e.target.value : x)),
                        )
                      }
                      placeholder={tTpl("signer_slot_placeholder")}
                      aria-label={tTpl("signer_slot_placeholder")}
                      className="max-w-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setProposalSigners((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      aria-label={tTpl("remove")}
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
                  onClick={() => setProposalSigners((prev) => [...prev, ""])}
                >
                  <Plus className="size-3.5" />
                  {tTpl("add_signer")}
                </Button>

                <label className="flex cursor-pointer items-center gap-2 border-t border-border/60 pt-3 text-sm">
                  <input
                    type="checkbox"
                    checked={proposalFirmCountersigns}
                    onChange={(e) =>
                      setProposalFirmCountersigns(e.target.checked)
                    }
                  />
                  {tTpl("signer_firm")}
                </label>

              </CardContent>
            </Card>
        </>
      )}

    </TemplateBuilderShell>
    </>
  );
}
