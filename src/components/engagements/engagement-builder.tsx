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
import {
  computeBillingTotals,
  invoiceAmountFromTotals,
} from "@/lib/engagements/billing-totals";
import {
  BLOCK_FREQUENCIES,
  defaultPriceVisibility,
  emptyBlock,
  flattenBlocks,
  withBillingType,
  type BillingBlock,
  type BlockFrequency,
  type PriceVisibility,
} from "@/lib/engagements/billing-blocks";
import { BillingBlocksEditor } from "@/components/templates/billing-blocks-editor";
import {
  findScopeWarning,
  type ScopeWarningContact,
} from "@/lib/relationships/validate";
import { addDays } from "date-fns";
import { taxPctForProvince } from "@/lib/tax/canada";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { createEngagementAction } from "@/app/actions/engagements";
import { openPlacementEditor } from "@/components/engagements/placement-editor";
import { ServiceLetterSection } from "@/components/templates/service-letter-section";
import type { Template, TemplateItem, DocType } from "@/lib/db/templates";
import {
  familyDefaultWorkflow,
  parseWorkflowDefinition,
  type StageAssigneeRule,
  type WorkflowDefinition,
} from "@/lib/workflow/definition";
import {
  flowSendsInvoice,
  withFlowLetter,
  workflowPlan,
} from "@/lib/workflow/plan";
import { AutomationEditor } from "@/components/workflow/automation-editor";
import { BUILTIN_NAME_KEYS } from "@/components/vylan/automations-panel";
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
  | "invoice_attachment_upload_error"
  // Two DIFFERENT walls, and they need different actions from the accountant:
  // the plan's active-engagement cap is full (finish or archive something), or
  // the free trial lapsed (book a call). Both were previously absent from this
  // union AND the set below, so the server's code rendered on screen as the raw
  // string `plan_limit_reached` — at the exact moment somebody is blocked.
  | "plan_limit_reached"
  | "trial_expired";
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
  "plan_limit_reached",
  "trial_expired",
]);

// Imported and re-exported, NOT re-declared: this file used to carry its own
// copy of the union, so adding a timing meant remembering to widen it twice.
export type { InvoiceAutoMode };
// Builder-local timing. Adds "now": create the invoice immediately at engagement
// creation (payable right away), vs. the deferred on_completion / delayed
// automation. "off" = no invoice.
export type InvoiceTiming =
  "off" | "now" | "on_acceptance" | "on_completion" | "delayed";

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
  "introduction" | "services" | "terms" | "acceptance"
> = {
  // Nothing has been chosen yet, so the preview shows the document's neutral
  // top rather than pretending a section is being edited.
  start: "introduction",
  // Who it is for and what it is called — the top of the client's document.
  details: "introduction",
  // The priced lines, and the work and money that hang off them. All three
  // land in the client's Services section.
  services: "services",
  tasks: "services",
  // The flow is invisible to the client (it is how the FIRM runs the job),
  // so, like reminders, it highlights the neutral introduction.
  automation: "introduction",
  billing: "services",
  // Chasing is invisible to the client, so it highlights nothing new — the
  // introduction is the honest neutral, not a section reminders belong to.
  reminders: "introduction",
  proposal: "acceptance",
};

const WIZARD_STEPS = [
  "details",
  "services",
  "tasks",
  // How this engagement RUNS — the flow it inherits from its template, made
  // visible and overridable (founder's Automation step). Between the work
  // and the money on purpose: the flow decides when the work appears and
  // when the invoice goes, so you meet it after defining one and before
  // pricing the other. Hidden entirely for firms without the switch.
  "automation",
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
  | "wizard_step_automation"
  | "wizard_step_billing"
  | "wizard_step_reminders"
  | "wizard_step_proposal";

// The one line under each step's name in the wizard's steps box.
type WizardStepDescKey =
  | "wizard_step_desc_details"
  | "wizard_step_desc_services"
  | "wizard_step_desc_tasks"
  | "wizard_step_desc_automation"
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
  firmProvince = null,
  servicePrices = {},
  services = [],
  engagementTemplates = [],
  taskTemplates = [],
  members = [],
  workflowsOn = false,
  automations = [],
  serviceIdsWithLetters = [],
  canUploadLetters = false,
  signwellEditorOn = false,
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
  /**
   * The firm's own province (1750) — the sales-tax fallback when the CLIENT has
   * none on file, which on production is 99 clients out of 103.
   *
   * The client's own province always wins where it is known: Canadian
   * place-of-supply for services goes by the recipient, so a Montreal firm
   * billing an Ontario client charges 13% and not 14.975%. This only answers
   * the case where nobody has filled one in.
   */
  firmProvince?: string | null;
  // Per-service default prices in cents (firms.service_prices), keyed by
  // engagement type — pre-fills the invoice amount.
  servicePrices?: Record<string, number>;
  /** The firm's service catalogue (migration 1480). Empty until it is applied. */
  services?: CatalogueService[];
  /** Active firm members, for the assignee picker. Empty in a solo firm, which
   *  hides the control entirely — there is nobody else to hand it to. */
  members?: { id: string; name: string }[];
  /** The Part A switch. Off hides the Automation step entirely — the wizard
   *  is byte-identical to before for unflagged firms. */
  workflowsOn?: boolean;
  /** The flows library, for the Automation step's picker. */
  automations?: {
    id: string;
    firmId: string | null;
    name: string;
    definition: WorkflowDefinition | null;
  }[];
  /** Which services have an engagement letter uploaded (1700) — the
   *  Automation step's letter status line. */
  serviceIdsWithLetters?: string[];
  /** can(user, "firm.settings") — whether the inline letter-attach renders.
   *  The upload action enforces the same capability server-side. */
  canUploadLetters?: boolean;
  /** SIGNWELL_API_APPLICATION_ID present — field placement is available. */
  signwellEditorOn?: boolean;
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
  // The Proposal step's labels — period, terms, deposit — already
  // exist in the Templates namespace, written for the template builder. They
  // are read from there rather than copied here: one label per concept, so the
  // engagement and the template that produced it can never word it differently.
  const tTpl = useTranslations("Templates");
  // The Automation step speaks the flow vocabulary three other surfaces
  // already use — one dictionary, no re-wording.
  const tAuto = useTranslations("Automations");
  const tStage = useTranslations("Stage");

  // The blank "Empty" template leads the list and is the default when the user
  // didn't arrive via a specific template ("Use" on a card). Everything else
  // keeps its incoming order.
  const orderedTemplates = useMemo(() => {
    const blank = templates.find((tt) => tt.id === BLANK_TEMPLATE_SEED_ID);
    if (!blank) return templates;
    return [
      blank,
      ...templates.filter((tt) => tt.id !== BLANK_TEMPLATE_SEED_ID),
    ];
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
  // A saved engagement chosen BEFORE arriving — "Use" on the Templates page,
  // via ?engagement_template=. Matched against the loaded list rather than
  // trusted: a stale id, or one private to somebody else, resolves to undefined
  // and the builder simply opens normally with the start chooser.
  //
  // Its fields seed the state directly rather than being applied by an
  // effect after mount. A mount effect would have to call the setters — which
  // is a render-then-correct flash, and the React Compiler rejects it outright.
  // (Declared before templateId below, which seeds from it.)
  const initialEngagementTemplate =
    initialEngagementTemplateId != null
      ? engagementTemplates.find((x) => x.id === initialEngagementTemplateId)
      : undefined;
  // The engagement template remembers which DOCUMENT template it was built
  // from (payload.documentTemplateId, workflows-sync fix). Restoring that
  // selection is what routes the document template's AUTOMATION onto
  // engagements created from an engagement template — without it they all
  // fell to the family default flow. Validated against the loaded list; a
  // stale id seeds nothing.
  const payloadDocTemplateId =
    initialEngagementTemplate?.payload.documentTemplateId ?? null;
  const [templateId, setTemplateId] = useState<string>(
    initialTemplate?.id ??
      (payloadDocTemplateId &&
      templates.some((tt) => tt.id === payloadDocTemplateId)
        ? payloadDocTemplateId
        : ""),
  );
  const seededTitle = initialEngagementTemplate?.payload.title.trim()
    ? initialEngagementTemplate.payload.title
    : "";

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
  // No switch any more (founder: the recreate-invoice toggle asked what the
  // priced lines already answer). A recreated occurrence always inherits this
  // engagement's invoice settings; parseInvoiceSnapshot still stores nothing
  // when there is no invoice to inherit, so a job with no billing stays
  // unbilled.
  const repeatInvoiceRecreate = true;
  // Scroll target for the Repeat section's "Set up the invoice" shortcut.
  const invoiceSectionRef = useRef<HTMLDivElement>(null);
  // Seeded at INIT, never by a mount effect (same doctrine as the template
  // seeding above): a deep-linked template whose flow carries a cadence must
  // show that cadence on first paint, not flash the firm default first.
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(
    () => {
      const seed = workflowsOn
        ? parseWorkflowDefinition(
            templates.find((tt) => tt.id === templateId)?.workflow,
          )?.reminders?.documents
        : null;
      return structuredClone(
        seed ?? reminderDefaultSettings ?? DEFAULT_REMINDER_SETTINGS,
      );
    },
  );
  // "flow" = the cadence the picked flow carries — the founder's named
  // preset ("select a preset automation you created or use the default").
  const [reminderPreset, setReminderPreset] = useState<
    "firm" | "vylan" | "custom" | "flow"
  >(() => {
    const seeded =
      workflowsOn &&
      parseWorkflowDefinition(
        templates.find((tt) => tt.id === templateId)?.workflow,
      )?.reminders?.documents;
    return seeded ? "flow" : reminderDefaultSettings ? "firm" : "vylan";
  });
  const [reminderPreviewBase] = useState(() => new Date());
  const [remindersExpanded, setRemindersExpanded] = useState(false);
  // Letters attached INLINE on the Automation step this session (founder:
  // "you can't attach the engagement letter you'd like to be automatically
  // sent out"). Uploads write to the service's own letter rows — the same
  // storage the Templates → Services tab manages — this list only keeps the
  // honesty line truthful without a server round-trip.
  const [attachedLetterServiceIds, setAttachedLetterServiceIds] = useState<
    string[]
  >([]);
  // ── HOW THE CLIENT AGREES — one question, asked first ───────────────────
  //
  // Founder: "you could just choose whether you wanna use the actual proposal
  // ... they just click on accept, they don't have to actually esign
  // anything. Or the option for the firm to upload their own engagement
  // letter for their client to sign. It's one or the two."
  //
  //   "proposal" — the client reads the generated document and taps Accept.
  //                No signature, no SignWell, no letter anywhere in the UI.
  //   "letter"   — the firm's own PDF goes out for signature and signing IS
  //                the acceptance. The proposal preview disappears: they are
  //                not using that document, so showing it is noise.
  //
  // Field placement is NOT a question (founder: "that shouldn't even be a
  // button"). Letter mode always opens SignWell's editor on create-and-send
  // when the editor is configured, and falls back to the appended signature
  // page when it isn't.
  const [agreementMode, setAgreementMode] = useState<"proposal" | "letter">(
    "proposal",
  );
  const letterMode = workflowsOn && agreementMode === "letter";
  // Invoice timing (migrations 0590 + 0610). Pre-selected from the firm default.
  // Only meaningful when Connect is ready; forced off otherwise.
  // ── BILLED WHEN THEY ACCEPT, BY DEFAULT ────────────────────────────────
  //
  // Founder: "have it so the 'invoice' is always on bill you client after they
  // accept."
  //
  // Acceptance is the moment the agreement becomes real, the deposit is taken
  // and the portal opens — so it is also when the bill should go out. It used to
  // default to the firm's saved mode, which for every firm that never opened
  // Settings is 'off', so the invoice quietly never went at all.
  //
  // The other timings stay available: on completion and delayed are how plenty
  // of tax work is genuinely billed, and removing them would break firms who
  // chose them deliberately. A firm that has SAVED a preference keeps it — that
  // is a decision somebody made — and everyone else now starts on acceptance.
  const [invoiceMode, setInvoiceMode] = useState<InvoiceTiming>(() => {
    if (!connectReady) return "off";
    return invoiceDefaultMode && invoiceDefaultMode !== "off"
      ? invoiceDefaultMode
      : "on_acceptance";
  });
  const [invoiceDelayDays, setInvoiceDelayDays] = useState<string>(
    invoiceDefaultDelayDays != null ? String(invoiceDefaultDelayDays) : "7",
  );
  // Amount source: use the firm's saved service price, or a custom amount.
  const [invoiceUseDefault, setInvoiceUseDefault] = useState(true);
  const [invoiceCustomAmount, setInvoiceCustomAmount] = useState<string>("");
  /**
   * Whether the accountant has typed their own figure over the calculated one.
   *
   * Until they do, "Amount to bill" FOLLOWS the service items — see
   * `invoiceAutoAmount` below. Once they type, it stops following, because a
   * number that silently rewrites itself after you have set it is worse than
   * one you had to enter.
   */
  const [invoiceAmountTouched, setInvoiceAmountTouched] = useState(false);
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
  const [proposalPeriodMonths, setProposalPeriodMonths] = useState<
    number | null
  >(tpl?.periodMonths ?? null);
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
        {
          ...emptyTask("document_collection"),
          title: t("task_seed_documents"),
        },
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
    work?: {
      templateId: string;
      name: string;
      kind: string;
      stepCount: number;
    } | null;
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
    // Same restoration as the ?engagement_template= arrival path: the saved
    // document-template selection routes the right automation. Chooser and
    // deep link must land identically or the flow depends on which door you
    // came through.
    if (
      p.documentTemplateId &&
      templates.some((tt) => tt.id === p.documentTemplateId)
    ) {
      setTemplateId(p.documentTemplateId);
      // The deep-link arrival seeds the flow's reminder cadence at state
      // init; the chooser path must land identically (this function's own
      // rule) — so it applies the same cadence here.
      if (workflowsOn) {
        applyFlowReminders(
          parseWorkflowDefinition(
            templates.find((tt) => tt.id === p.documentTemplateId)?.workflow,
          ),
        );
      }
    }
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

  // ── THE OPENING QUESTION IS STEP ONE, NOT A DOORWAY ────────────────────
  //
  // Founder: "have this tab and the other be the same thing instead of two
  // separate steps, they transition into one another... so it doesn't look
  // weird."
  //
  // It used to be its own EngagementModalShell — a bare dialog with a lone
  // Next button — which then vanished and was replaced by a three-column
  // wizard. Two different objects for one continuous act. Now the question is
  // simply the wizard's first step: same card, same rail, same preview, same
  // footer, and only the middle changes. Nothing about the flow moved; the
  // chrome around it stopped changing shape.
  //
  // Its answer lives here rather than inside the chooser because the SHELL's
  // Continue is what commits it now. The chooser draws the question and
  // reports what was picked; it no longer owns a button.
  // NULL until they answer, and that is the point. Founder: "have the entire
  // page be blank with no start... then have the client preview appear when
  // they select one or the other." Pre-selecting a card would answer the
  // question on their behalf and light the preview before they had chosen
  // anything to preview.
  const [startMode, setStartMode] = useState<"template" | "scratch" | null>(
    null,
  );
  const [startTemplateId, setStartTemplateId] = useState<string>(
    engagementTemplates[0]?.id ?? "",
  );
  // What the last commit actually applied. Re-answering the same way must NOT
  // re-apply — otherwise stepping Back to look at the question and pressing
  // Continue silently wipes everything typed since.
  const [appliedStart, setAppliedStart] = useState<string | null>(null);

  function commitStart(target: WizardStep) {
    const choice =
      startMode === "template" && startTemplateId !== ""
        ? startTemplateId
        : null;
    // Only a CHANGED template overwrites the form. Switching to "from scratch"
    // deliberately leaves what is there rather than blanking work — undoing a
    // template is not what that card promises.
    if (choice !== null && choice !== appliedStart) {
      applyEngagementTemplate(choice);
    }
    setAppliedStart(choice);
    setStarted(true);
    setStep(target);
  }

  // NOTE: `stepComplete` lived here and fed the rail's red "not answered yet"
  // dot. The founder removed the dot ("no need for the red dots"), and nothing
  // else read this map — the rail's green ticks are the shell's own, and the
  // send button does its own checking — so it went with it rather than sitting
  // here as a computed value with no consumer.
  //
  // How many times "Create and send" was pressed with an empty checklist.
  // From the 2nd attempt we ring the checklist so the reason is obvious.
  const [pending, startTransition] = useTransition();
  // The wizard's ✕ and Esc both close by NAVIGATING — this screen is a route,
  // not a mounted dialog, which is the decision three lag bugs were fixed by.
  const router = useRouter();

  const selectedTemplate = templates.find((tt) => tt.id === templateId);
  const selectedClient = clients.find((client) => client.id === clientId);

  // ── THE FLOW THIS ENGAGEMENT WILL RUN (the Automation step) ──────────────
  // Default: the picked template's own copy, else the family preset — the
  // same resolution the server performs, shown BEFORE creation instead of
  // silently after. `flowPick` is the per-engagement override: a different
  // flow from the library, or this one customized in place. It is sent to
  // the server verbatim and outranks the template there; the library and the
  // template are never modified from here.
  const [flowPick, setFlowPick] = useState<{
    def: WorkflowDefinition;
    automationId: string | null;
    customized: boolean;
  } | null>(null);
  const templateFlow = parseWorkflowDefinition(selectedTemplate?.workflow);
  const activeFlow: WorkflowDefinition =
    flowPick?.def ??
    templateFlow ??
    familyDefaultWorkflow(selectedTemplate?.type ?? "custom");
  // Which picked services still lack an engagement letter — the Automation
  // step's honesty line, only when this flow actually sends one.
  const pickedServiceIds = [
    ...new Set(
      serviceItems
        .map((x) => x.serviceId)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  // THE letter rides the FIRST catalogue line, in proposal order — the exact
  // rule resolveServiceId applies at send time (workflow/letter.ts). The old
  // count-all-missing warning could both cry wolf (a letterless second
  // service whose letter would never send) and stay silent about the one
  // that mattered.
  // ── ONE RECURRENCE, AND THE AUTOMATION STEP OWNS IT ─────────────────────
  // Founder: "you can't select if you want a quarterly, monthly, or yearly
  // anymore... there's now recurring still on service items, when you should
  // just be able to do that from automation."
  //
  // So the mode card is a CONTROL, not a readout: picking "Bills repeatedly"
  // converts the priced blocks to recurring at the frequency chosen right
  // there, and the One-time/Recurring pills leave the Services step entirely
  // (BillingBlocksEditor's hideBillingType).
  // ── TWO QUESTIONS, NOT ONE (founder ruling, after three attempts) ───────
  //
  // "How often does the WORK repeat?" and "How often do they PAY?" are
  // different facts, and an annual T2 paid $300/month is an ordinary
  // arrangement this app could not express while they were one either/or
  // control. They are independent now; what made them dangerous together —
  // each spawned occurrence opening a SECOND payment schedule on top of the
  // last — is fixed at the source (start-schedules.ts keeps one schedule per
  // series), not papered over by forbidding the combination.
  const recurringBlocks = blocks.filter((b) => b.billingType === "recurring");
  const hasRecurringItems = recurringBlocks.length > 0;
  // What the client pays on: "once" or a cadence. All priced lines share it —
  // a proposal that bills some lines monthly and others quarterly is a thing
  // the block editor can still express, but this card speaks for the common
  // case and shows the first cadence when they differ.
  const payCadence: "once" | BlockFrequency = hasRecurringItems
    ? (recurringBlocks[0]?.frequency ?? "monthly")
    : "once";

  // ── ONE ON/OFF, THEN THE DETAILS ────────────────────────────────────────
  // Founder: "have it in one little button so you could select doesn't repeat
  // if you don't want anything repeating. Then... you click on recurring, and
  // it shows billing... it shows the entire work job option."
  //
  // So: does anything about this job repeat — yes or no. Yes reveals BOTH
  // knobs (bill the client / redo the job); no clears them. Three sibling
  // modes were the mistake: "doesn't repeat" was never the same KIND of
  // answer as the other two, so listing them together read as nonsense.
  //
  // Held as state rather than derived, so answering "yes" can show the two
  // rows before either has been set — otherwise the control would snap back
  // to "no" the moment it was opened.
  const [recurringOpen, setRecurringOpen] = useState(
    () => hasRecurringItems || repeatFrequency !== "off",
  );

  function setRecurring(open: boolean) {
    setRecurringOpen(open);
    if (!open) {
      // "Doesn't repeat" means exactly that — neither the money nor the work.
      setPayCadence("once");
      setRepeatFrequency("off");
    }
  }

  /** Sets how often the CLIENT PAYS. Never touches the work schedule. */
  function setPayCadence(next: "once" | BlockFrequency) {
    if (next === "once") {
      setBlocks((prev) => prev.map((b) => withBillingType(b, "one_time")));
      return;
    }
    setBlocks((prev) =>
      prev.map((b) =>
        b.billingType === "recurring"
          ? { ...b, frequency: next }
          : { ...withBillingType(b, "recurring"), frequency: next },
      ),
    );
  }

  // Same filter the submit payload applies (empty-named lines are dropped
  // before they reach the server), so the service named here can never
  // differ from the one resolveServiceId picks at send time.
  const sendingService =
    serviceItems.find((x) => x.serviceId && x.name.trim().length > 0) ?? null;
  const sendingServiceId = sendingService?.serviceId ?? null;
  const sendingServiceName = sendingService?.name.trim() || null;
  const sendingLetterMissing =
    sendingServiceId != null &&
    !serviceIdsWithLetters.includes(sendingServiceId) &&
    !attachedLetterServiceIds.includes(sendingServiceId);
  // The plan line's "handed to" wording. A helper because TypeScript loses
  // the null-narrowing inside a .find callback in JSX.
  function flowAssigneeName(rule: StageAssigneeRule): string {
    if (rule === "owner") return tAuto("assignee_owner");
    if (rule === "staff") return tAuto("assignee_staff");
    return (
      members.find((m) => m.id === rule.member_id)?.name ??
      tAuto("assignee_staff")
    );
  }
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

  // ── THE RATE THIS ENGAGEMENT'S LINES SHOULD CARRY ─────────────────────
  //
  // Client first, firm second. The client's province is the CORRECT basis and
  // the firm's is the useful one — shipping only the correct one is why the
  // founder said "can't see the change": it was right for four clients and
  // silent for ninety-nine.
  //
  // Null when neither is known, and null stays null: the box is left empty
  // rather than filled with a rate no address produced.
  const engagementTaxPct = taxPctForProvince(selectedProvince ?? firmProvince);

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
  const money = (cents: number) =>
    new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(cents / 100);

  /** When the occurrence's invoice goes out, as a sentence FRAGMENT. The
   *  Billing step's dropdown labels are written as options ("Now, so they can
   *  pay right away") and read as gibberish mid-sentence. */
  function invoiceWhenPhrase(): string {
    if (invoiceMode === "delayed") {
      return t("repeat_invoice_when_delayed", {
        days: Math.max(1, Math.floor(Number(invoiceDelayDays) || 0)),
      });
    }
    return t(`repeat_invoice_when_${invoiceMode}` as "repeat_invoice_when_now");
  }

  function currentInvoiceAmountCents(): number | null {
    return resolveInvoiceAmountCents({
      mode: invoiceMode === "off" ? "off" : "on_completion",
      useDefault: invoiceUseDefault,
      defaultCents: invoiceDefaultCents,
      customAmount: invoiceAmountValue,
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

  // ── AMOUNT TO BILL, CALCULATED ────────────────────────────────────────
  //
  // Founder: "why do you have to enter an amount to bill twice? ... It should
  // just be automatically calculated based on the service items. And it's just
  // optionally changeable. and then have it sync with the preview."
  //
  // Right — you had priced every line on step 2 and then typed the sum again on
  // step 4, from memory, with nothing checking that the two agreed. They are
  // the same number now, from the same computeBillingTotals the proposal
  // preview totals itself with, so the invoice and the document a client signed
  // cannot say different things.
  //
  // ⚠️ oneTimeTotalCents, NOT totalCents. `totalCents` adds every frequency
  // together and is explicitly documented in billing-totals.ts as "not a price
  // anyone pays" — a $4,000 setup plus $500/month is not a $4,500 invoice. The
  // one-time lines are what is payable up front, which is what an invoice
  // raised from this engagement charges.
  //
  // The rule itself lives in billing-totals.ts beside the numbers it reads, so
  // it is testable and so the next person to touch the money finds it there
  // rather than buried in three thousand lines of form.
  const invoiceAutoAmount = invoiceAmountFromTotals(billingTotals);
  // DERIVED, not an effect. An effect writing state on every keystroke of a
  // rate field would fight the input it is trying to help.
  const invoiceAmountValue = invoiceAmountTouched
    ? invoiceCustomAmount
    : invoiceAutoAmount;

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
    // The template's flow becomes the active flow (unless overridden), so
    // its reminder cadence applies in the same gesture — flow = the preset.
    // NOT on a re-click of the already-selected card, and NEVER over a
    // hand-tuned cadence: "custom" means the founder edited the steps, and
    // a template click on another tab must not silently discard that.
    if (
      workflowsOn &&
      !flowPick &&
      id !== templateId &&
      reminderPreset !== "custom"
    ) {
      applyFlowReminders(parseWorkflowDefinition(tmpl?.workflow));
    }
  }

  function updateItem(idx: number, patch: Partial<TemplateItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
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

  function applyReminderPreset(value: "firm" | "vylan" | "custom" | "flow") {
    if (value === "custom") return;
    if (value === "flow") {
      // Re-apply what the active flow says; the option only renders when it
      // says something (activeFlow.reminders?.documents non-null).
      const fromFlow = activeFlow?.reminders?.documents;
      if (!fromFlow) return;
      setReminderPreset("flow");
      setReminderSettings(structuredClone(fromFlow));
      return;
    }
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

  // Picking a flow applies its cadence in the same gesture — the flow IS the
  // reminder preset. A flow with no opinion leaves a hand-tuned cadence
  // alone, but must not keep wearing the "From the flow" label for a cadence
  // the PREVIOUS flow supplied — that falls back to the firm/Vylan preset.
  function applyFlowReminders(def: WorkflowDefinition | null) {
    const docs = def?.reminders?.documents;
    if (!docs) {
      if (reminderPreset === "flow") {
        applyReminderPreset(reminderDefaultSettings ? "firm" : "vylan");
      }
      return;
    }
    setReminderSettings(structuredClone(docs));
    setReminderPreset("flow");
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
            // The Automation step's answer, when the user gave one. Absent =
            // the server derives from template_id exactly as before.
            // The flow, with the LETTER forced to match the agreement choice
            // — that choice is the whole question of how the client agrees,
            // so it outranks whatever the picked flow happened to carry.
            // Sent whenever the switch is on (not only when a flow was
            // picked), because "use the proposal" has to be able to turn a
            // template's letter OFF.
            ...(workflowsOn
              ? {
                  workflow_definition: withFlowLetter(activeFlow, letterMode),
                  automation_id: flowPick?.automationId ?? null,
                }
              : {}),
            // Placement is automatic, not a choice: letter mode uses
            // SignWell's editor whenever it is configured. Without the
            // editor app id the sender falls back to the appended signature
            // page on its own, so sending this is always safe.
            ...(letterMode && signwellEditorOn
              ? { workflow_letter_placement: "editor" as const }
              : {}),
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
                // How long this line is expected to take (1820), seeded from
                // the catalogue when a service was picked and editable on the
                // row. Without it a hand-typed line reached the capacity board
                // as zero hours, silently.
                budget_minutes: i.budgetMinutes ?? null,
              })),
            // What the work consists of. Titled rows only — an untitled row
            // left over from a stray "+ Add task" click must not land on the
            // engagement as a nameless entry.
            // ── THE PROPOSAL, FROZEN (1660) ──────────────────────────────
            // Built from the engagement template this started from, because
            // that is the only place terms and the welcome message exist.
            // Sent as a SNAPSHOT so a client who agrees
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
        } else if (
          result &&
          "letterEditUrl" in result &&
          result.letterEditUrl &&
          result.letterItemId &&
          result.engagementId
        ) {
          // Editor-mode letter: the action RETURNED instead of redirecting
          // (a redirect would strand the one-shot placement URL). Open the
          // SHARED placement editor (open + finalize live in exactly one
          // place — placement-editor.ts), then land on the engagement like
          // every other create. Closed-without-finishing leaves the draft
          // pending — the engagement page's letter-placement card resumes it.
          const dest = `/engagements/${result.engagementId}`;
          try {
            await openPlacementEditor({
              url: result.letterEditUrl,
              itemId: result.letterItemId,
              onSettled: () => router.push(dest),
            });
          } catch {
            router.push(dest);
          }
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
      // Which document template the checklist (and therefore the automation)
      // came from — the link that makes engagements built from this template
      // run the SAME flow as this one (workflows-sync fix).
      documentTemplateId: selectedTemplate?.id ?? null,
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
        "start from a template?" question no longer uses it either: it is this
        wizard's first step, so the card never changes shape between asking the
        question and answering it. */}
      <TemplateBuilderShell
        kicker={t("kicker_engagement")}
        title={t("new_title")}
        explainer={t("wizard_explainer")}
        // ── THE QUESTION IS A BLANK CARD, NOT A STEP ───────────────────
        // Founder: "have the entire page be blank with no start. Because if
        // they choose template there would be no steps to go through."
        //
        // Exactly right: the steps are a CONSEQUENCE of the answer, so listing
        // seven of them beside an unanswered question promises a road nobody
        // has chosen yet. ONE tab puts the shell in its single-card mode — the
        // same one the quick-create sheets use — which draws no rail, no
        // counter and no Back, so the screen is the question and nothing else.
        tabs={
          !started
            ? [{ key: "start", label: t("new_title") }]
            : [
                ...WIZARD_STEPS.filter(
                  // No switch, no step — the wizard reads exactly as before for
                  // unflagged firms, and a stale deep link to the step falls to details.
                  // With the switch, the standalone Reminders step disappears instead:
                  // the founder's ruling is that reminders live INSIDE the automations,
                  // so the same card renders on the Automation step and nowhere else.
                  // And in LETTER mode the Proposal step goes with the preview: it
                  // builds the intro, terms and acceptance block of a document this
                  // client will never open — their engagement letter carries all of
                  // that. A step that composes something nobody reads is exactly the
                  // kind of useless surface this wizard keeps being cleared of.
                  (k) =>
                    (workflowsOn ? k !== "reminders" : k !== "automation") &&
                    !(letterMode && k === "proposal"),
                ).map((k): BuilderTab => ({
                  key: k,
                  label: t(`wizard_step_${k}` as WizardStepKey),
                  description: t(`wizard_step_desc_${k}` as WizardStepDescKey),
                })),
              ]
        }
        // Derived, not stored: while the question is unanswered the wizard is ON
        // it, and `step` keeps pointing at where Continue will land. That is what
        // lets Back walk into the question and out again without a second piece
        // of state that could disagree with this one.
        // The opening question is one tab, but it must not shrink: it is the
        // same card the wizard is about to fill in, so it stays the same size
        // and only its contents change.
        size="wizard"
        activeTab={started ? step : "start"}
        onTabChange={(k) => setStep(k as WizardStep)}
        onClose={() => router.push("/engagements")}
        // Save draft keeps a half-finished engagement; Save as template keeps its
        // SHAPE. Both were in the old split button, and both survive — they are
        // the two ways of leaving this screen without sending, and the handoff's
        // header (one outline button + ✕) has room for them.
        // Empty on the question: there is no engagement yet to save as a draft
        // and no shape yet to save as a template. Buttons that cannot work.
        headerActions={
          !started
            ? []
            : [
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
              ]
        }
        // On the Proposal step — the last one — Continue becomes the send. It is
        // the only thing left to do there, and a greyed-out Next said nothing.
        finalAction={
          !started
            ? {
                // Dead until they answer. There is nothing to continue INTO
                // while the question is open, and a live button would pick
                // for them.
                label: tTpl("continue_step"),
                disabled: startMode == null,
                icon: "arrow" as const,
                onClick: () => commitStart("details"),
              }
            : {
                label: t("create_and_send"),
                disabled: pending,
                onClick: () => submit(true),
              }
        }
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
        // LETTER MODE SHOWS NO PREVIEW. Founder: "they do not see the sample
        // client, the preview of the sample client because there's no point in
        // seeing it — they're not using it, they're only getting their own
        // engagement letter." The whole pane goes, not just the document.
        preview={
          // The question screen has NO preview. It arrives with the wizard, on
          // Continue — founder: "the preview only shows up after you click on
          // continue on that page."
          !started || letterMode ? null : (
            <div className="w-full space-y-4">
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
          )
        }
      >
        {!started && (
          <EngagementStartChooser
            templates={engagementTemplates.map((x) => ({
              id: x.id,
              name: x.name,
              access: x.access,
            }))}
            mode={startMode}
            templateId={startTemplateId}
            onModeChange={setStartMode}
            onTemplateChange={setStartTemplateId}
          />
        )}

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
        {started && step === "details" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("section_client")}
                </CardTitle>
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
                <CardTitle className="text-base">
                  {t("section_details")}
                </CardTitle>
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
                  <Label htmlFor="due_date">
                    {t("field_due_date_optional")}
                  </Label>
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
                  <Label htmlFor="tax_year">
                    {t("builder_tax_year_label")}
                  </Label>
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
                      <Sparkles
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
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

            {/* ── HOW THEY AGREE ────────────────────────────────────────────
              Asked HERE, first, because it decides what the rest of the
              wizard even shows: the proposal document and its preview, or a
              signed engagement letter. Two radio cards rather than a switch
              — neither answer is the "off" state of the other. */}
            {workflowsOn && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t("agreement_mode_title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["proposal", "letter"] as const).map((mode) => (
                      <RadioCard
                        key={mode}
                        name="engagement-agreement-mode"
                        checked={agreementMode === mode}
                        onSelect={() => setAgreementMode(mode)}
                        // caption renders ABOVE the bold label in this shared
                        // card, so it carries the short descriptor.
                        caption={t(
                          mode === "proposal"
                            ? "agreement_mode_proposal_kicker"
                            : "agreement_mode_letter_kicker",
                        )}
                        label={t(
                          mode === "proposal"
                            ? "agreement_mode_proposal"
                            : "agreement_mode_letter",
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(
                      agreementMode === "proposal"
                        ? "agreement_mode_proposal_hint"
                        : "agreement_mode_letter_hint",
                    )}
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* STEP 2 — the SCOPE. What you are doing for them and what it costs.
          Not the document checklist: that answers "what do I need FROM the
          client", this answers "what am I DOING for them". They were the same
          thing only because one of them had no table (migration 1450). */}
        {step === "services" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("section_services")}
              </CardTitle>
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
                // ── THE TAX FILLS ITSELF IN ────────────────────────────────
                // Founder: "make the tax percentage on a service item fill
                // automatically based on the province you're in."
                //
                // From the CLIENT's province, not the firm's — Canadian
                // place-of-supply for services puts the rate on the recipient,
                // which is why a Montreal firm bills an Ontario client 13% and
                // not 14.975%. It was `null` here, and the only other source
                // (`firm.default_tax_pct`) is a column that exists in no
                // migration, so this box has been blank for everybody since it
                // was built.
                //
                // Still a SUGGESTION: a line that carries its own rate wins, the
                // same rule the service catalogue already follows.
                fallbackTaxPct={engagementTaxPct}
                // Recurrence lives on the Automation step now — one screen
                // decides whether and how this repeats, so these pills would
                // be a second place to answer the same question.
                hideBillingType={workflowsOn}
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
                                <option value="">
                                  {t("task_assignee_none")}
                                </option>
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
                                {t("task_from_service", {
                                  name: task.sourceLabel,
                                })}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addTask}
                >
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
                <CardTitle className="text-base">
                  {t("section_template")}
                </CardTitle>
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
                      requiredCount={
                        tmpl.items.filter((it) => it.required).length
                      }
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                >
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
                                onChange={(dt) =>
                                  updateItem(idx, { doc_type: dt })
                                }
                                className="h-8 w-[14rem] max-w-full text-xs"
                                province={selectedProvince}
                                includeQuebecForms={includeQuebecForms}
                              />
                              <label className="flex items-center gap-1.5 select-none cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={item.required}
                                  onChange={(e) =>
                                    updateItem(idx, {
                                      required: e.target.checked,
                                    })
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
        {/* ── THE AUTOMATION STEP ──────────────────────────────────────────
          What this engagement will DO, before it exists: the flow inherited
          from the template, each stage as a plan line, the letter's status,
          and a per-engagement override that never touches the library. */}
        {step === "automation" && workflowsOn && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {tAuto("flow_runs_label")}
              </span>
              <Select
                value={flowPick?.automationId ?? "template"}
                onValueChange={(v) => {
                  if (v === "template") {
                    setFlowPick(null);
                    // Reverting to the template re-applies ITS cadence (when
                    // it has one) in the same gesture, like picking any flow.
                    applyFlowReminders(templateFlow);
                    return;
                  }
                  const a = automations.find((x) => x.id === v);
                  if (a?.definition) {
                    setFlowPick({
                      def: a.definition,
                      automationId: a.id,
                      customized: false,
                    });
                    applyFlowReminders(a.definition);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-72 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="template">
                    {tAuto("flow_from_template")}
                  </SelectItem>
                  {automations.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.firmId === null && BUILTIN_NAME_KEYS[a.id]
                        ? tAuto(BUILTIN_NAME_KEYS[a.id])
                        : a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {flowPick?.customized && (
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] text-accent">
                  {tAuto("flow_customized_chip")}
                </span>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              {/* The journey BEFORE the flow — the founder: "it goes from
                draft to sent to the client accepts, and then it can move
                into collecting... but it doesn't display over here." Now it
                does. The letter belongs to the SEND line (signing it is how
                the client accepts), and the accept line only renders when
                this engagement will actually hold for one — a plain
                document request starts the moment it is sent. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/20 px-4 py-2.5 text-sm">
                <span className="font-medium">{tAuto("plan_sent_title")}</span>
                {letterMode && (
                  <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] text-accent">
                    {tAuto("action_send_engagement_letter")}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {tAuto("plan_sent_note")}
                </span>
              </div>
              {pickedServiceIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/20 px-4 py-2.5 text-sm">
                  <span className="font-medium">
                    {tAuto("plan_accept_title")}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {letterMode
                      ? tAuto("plan_accept_note_letter")
                      : tAuto("plan_accept_note")}
                  </span>
                </div>
              )}
              {workflowPlan(activeFlow).map((line) => (
                <div
                  key={line.stage}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span className="font-medium">
                    {tStage(`stage_${line.stage}`)}
                  </span>
                  {line.assignee != null && (
                    <span className="text-xs text-muted-foreground">
                      → {flowAssigneeName(line.assignee)}
                    </span>
                  )}
                  {line.actions
                    // The letter renders on the "Sent to the client" line
                    // above — showing it here too would claim two sends.
                    .filter((a) => a !== "send_engagement_letter")
                    .map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] text-accent"
                      >
                        {tAuto(`action_${a}`)}
                      </span>
                    ))}
                  {line.taskCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {tAuto("summary_tasks", { count: line.taskCount })}
                    </span>
                  )}
                  {line.advance && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {tAuto(`condition_${line.advance.condition}`)} ·{" "}
                      {tAuto(
                        line.advance.mode === "confirm"
                          ? "mode_confirm"
                          : "mode_automatic",
                      )}
                    </span>
                  )}
                  {/* "Completed" said nothing about what completing DOES —
                    the founder had to ask whether paid means done. */}
                  {line.stage === "completed" && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {tAuto("plan_completed_note")}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* The letter honesty block, keyed to the ONE service whose letter
              actually rides the send (the first catalogue line, in proposal
              order — resolveServiceId's rule). Missing + allowed to fix =
              attach it RIGHT HERE (founder: "you can't attach the engagement
              letter you'd like to be automatically sent out"), via the SAME
              ServiceLetterSection the service builder mounts. */}
            {letterMode &&
              (pickedServiceIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {tAuto("flow_letter_needs_service")}
                </p>
              ) : sendingServiceId &&
                canUploadLetters &&
                (sendingLetterMissing ||
                  attachedLetterServiceIds.includes(sendingServiceId)) ? (
                // Stays mounted after the first upload (the attached-ids check)
                // so the second language's PDF can go up — or a mis-pick come
                // back down — without leaving the builder.
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.04] p-4">
                  <p className="text-xs text-muted-foreground">
                    {sendingLetterMissing
                      ? tAuto("flow_letter_attach_here", {
                          service: sendingServiceName ?? "",
                        })
                      : tAuto("flow_letter_ok_for", {
                          service: sendingServiceName ?? "",
                        })}
                  </p>
                  <div className="mt-2.5">
                    <ServiceLetterSection
                      key={sendingServiceId}
                      serviceId={sendingServiceId}
                      initial={[]}
                      onRowsChange={(rows) =>
                        setAttachedLetterServiceIds((prev) =>
                          rows.length > 0
                            ? [...new Set([...prev, sendingServiceId])]
                            : prev.filter((x) => x !== sendingServiceId),
                        )
                      }
                    />
                  </div>
                </div>
              ) : sendingLetterMissing ? (
                <p className="text-xs text-muted-foreground">
                  {tAuto("flow_letter_missing_for", {
                    service: sendingServiceName ?? "",
                  })}
                </p>
              ) : (
                // Keyed to the ONE service that sends — the old "every picked
                // service has its letter" line claimed more than the send does.
                <p className="text-xs text-muted-foreground">
                  {sendingServiceName
                    ? tAuto("flow_letter_ok_for", {
                        service: sendingServiceName,
                      })
                    : tAuto("flow_letters_ok")}
                </p>
              ))}

            {/* NO placement switch (founder: "that shouldn't even be a button
              ... the e-signing process will be automatic when they click
              create and send"). Letter mode opens SignWell's editor by
              itself; this line just says so, once. */}
            {letterMode && signwellEditorOn && (
              <p className="text-xs text-muted-foreground">
                {tAuto("flow_letter_place_note")}
              </p>
            )}

            <details className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                {tAuto("flow_customize")}
              </summary>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                {tAuto("flow_override_note")}
              </p>
              <AutomationEditor
                value={activeFlow}
                onChange={(def) =>
                  setFlowPick({
                    def,
                    automationId: flowPick?.automationId ?? null,
                    customized: true,
                  })
                }
                members={members}
                // Per-engagement document chasing is the Reminders card on
                // THIS step (engagements.reminder_settings — what the
                // scheduler reads). A second documents editor here would take
                // edits that are dead for this engagement. Invoice stays: the
                // snapshot's invoice cadence IS read at billing time.
                hideDocumentReminders
                // Same reason, one card up: the agreement choice decides
                // whether a letter goes out, and the save above forces the
                // flow's flag to match it. Offering the switch here would take
                // an answer and discard it — and on a proposal-only engagement
                // it offered to sign a document that does not exist.
                hideLetterToggle
              />
            </details>
          </section>
        )}

        {step === "billing" && serviceItems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("details_services")}
              </CardTitle>
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
              <CardTitle className="text-base">
                {t("payment_settings")}
              </CardTitle>
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
            </CardContent>
          </Card>
        )}

        {/* ── TWO QUESTIONS, ASKED SEPARATELY (founder ruling) ──────────────
          One dropdown that changed the meaning of the dropdown beneath it —
          sometimes "how often money moves", sometimes "how often work
          happens" — is what made this unreadable ("i'm not understanding
          anymore"). They are two labelled rows now, each answerable on its
          own, and an annual job paid monthly is finally expressible. What
          made the combination dangerous is fixed in the engine, not by
          forbidding it. Unflagged firms keep the old single Repeat card. */}
        {(workflowsOn ? step === "automation" : step === "billing") && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Repeat className="size-4 text-muted-foreground" aria-hidden />
                {workflowsOn
                  ? t("cadence_card_title")
                  : t("repeat_section_label")}
              </CardTitle>
              {workflowsOn ? (
                // ONE question at the top: does anything here repeat?
                <Select
                  value={recurringOpen ? "recurring" : "none"}
                  onValueChange={(v) => setRecurring(v === "recurring")}
                >
                  <SelectTrigger
                    className="w-48"
                    aria-label={t("cadence_card_title")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("cadence_none")}</SelectItem>
                    <SelectItem value="recurring">
                      {t("cadence_recurring")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={repeatFrequency}
                  onValueChange={(value) => {
                    const next = value as
                      "off" | "monthly" | "quarterly" | "yearly" | "custom";
                    setRepeatFrequency(next);
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
                    <SelectItem value="monthly">
                      {t("repeat_monthly")}
                    </SelectItem>
                    <SelectItem value="quarterly">
                      {t("repeat_quarterly")}
                    </SelectItem>
                    <SelectItem value="yearly">{t("repeat_yearly")}</SelectItem>
                    <SelectItem value="custom">{t("repeat_custom")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Nothing repeats: the card says so and stops. No knobs to
                  read, no frequency sitting there meaning nothing. */}
              {workflowsOn && !recurringOpen && (
                <p className="text-xs text-muted-foreground">
                  {t("cadence_none_hint")}
                </p>
              )}
              {workflowsOn && recurringOpen && (
                <>
                  {/* 1 — the MONEY. */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label
                      htmlFor="pay-cadence"
                      className="text-sm font-normal"
                    >
                      {t("cadence_pay_label")}
                    </Label>
                    <Select
                      value={payCadence}
                      onValueChange={(v) =>
                        setPayCadence(v as "once" | BlockFrequency)
                      }
                    >
                      <SelectTrigger
                        id="pay-cadence"
                        className="w-52"
                        aria-label={t("cadence_pay_label")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="once">
                          {t("cadence_pay_once")}
                        </SelectItem>
                        {BLOCK_FREQUENCIES.map((f) => (
                          <SelectItem key={f} value={f}>
                            {tTpl(`freq_${f}` as "freq_monthly")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 2 — the WORK. */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <Label
                      htmlFor="repeat-frequency"
                      className="text-sm font-normal"
                    >
                      {t("cadence_work_label")}
                    </Label>
                    <Select
                      value={repeatFrequency}
                      onValueChange={(value) => {
                        const next = value as
                          "off" | "monthly" | "quarterly" | "yearly" | "custom";
                        setRepeatFrequency(next);
                        if (next === "custom" && repeatAnchorDay === "") {
                          setRepeatAnchorDay(String(new Date().getDate()));
                        }
                      }}
                    >
                      <SelectTrigger
                        id="repeat-frequency"
                        className="w-52"
                        aria-label={t("cadence_work_label")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">
                          {t("cadence_work_once")}
                        </SelectItem>
                        <SelectItem value="monthly">
                          {t("repeat_monthly")}
                        </SelectItem>
                        <SelectItem value="quarterly">
                          {t("repeat_quarterly")}
                        </SelectItem>
                        <SelectItem value="yearly">
                          {t("repeat_yearly")}
                        </SelectItem>
                        <SelectItem value="custom">
                          {t("repeat_custom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Says the pair back as one sentence, so a combination
                      like "yearly work, monthly payments" is confirmed in
                      words rather than inferred from two dropdowns. */}
                  <p className="text-xs text-muted-foreground">
                    {payCadence === "once" && repeatFrequency === "off"
                      ? t("cadence_summary_neither")
                      : payCadence !== "once" && repeatFrequency === "off"
                        ? t("cadence_summary_pay_only")
                        : payCadence === "once" && repeatFrequency !== "off"
                          ? t("cadence_summary_work_only")
                          : t("cadence_summary_both")}
                  </p>
                </>
              )}
              {!workflowsOn && (
                <p className="text-xs text-muted-foreground">
                  {t("repeat_section_hint")}
                </p>
              )}

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
              {/* ── NO "recreate the invoice" SWITCH ────────────────────────
                  Founder, seeing it under the recurrence picker: "are these
                  not the same thing?" Near enough. A recreated occurrence
                  already carries the priced service lines AND their timing,
                  and those lines bill themselves through the ordinary
                  acceptance path — so the switch was asking a question the
                  proposal already answered, in the vocabulary of a typed
                  flat amount that predates priced lines.
                  Each occurrence now simply bills the way this one does;
                  the sentence below says so instead of a control. */}
              {/* SAY THE MONEY, don't gesture at it. "Bills the way this one
                  does" told the founder nothing about what THIS one bills,
                  so the card read as though it might contradict the
                  frequency above it. The amount and the timing are both
                  known right here — state them, and any contradiction
                  becomes visible instead of suspected. */}
              {repeatFrequency !== "off" && connectReady && (
                <p className="flex items-start gap-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <Receipt className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {invoiceMode === "off" || currentInvoiceAmountCents() == null
                    ? t("repeat_invoice_none_yet")
                    : t("repeat_invoice_each", {
                        amount: money(currentInvoiceAmountCents() ?? 0),
                        when: invoiceWhenPhrase(),
                      })}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* STEP — money. */}
        {step === "billing" && (
          <>
            {/* Invoice (migrations 0590 + 0610) — its own top-level card. The
              wrapper div is the scroll target of the Repeat card's "Set up the
              invoice" shortcut. Without Stripe Connect the card still shows, with
              the connect note, so the section isn't silently absent. */}
            <div ref={invoiceSectionRef}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-base">
                    <Receipt
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    {t("invoice_section_label")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {connectReady ? (
                    <>
                      {/* ONE OWNER FOR INVOICE TIMING (founder's merge ruling):
                      when this engagement's flow raises the invoice itself,
                      asking the question again here would be a second owner
                      of the same decision — the server coerces it anyway, so
                      offering the picker would be offering a lie. The
                      Automation step is where the timing now reads and where
                      it can be changed. Amount fields below stay: the flow
                      bills whatever is entered here. */}
                      {workflowsOn && flowSendsInvoice(activeFlow) ? (
                        <p className="text-xs text-muted-foreground">
                          {tAuto("flow_owns_invoice_note")}
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {t("invoice_section_hint")}
                          </p>
                          <Select
                            value={invoiceMode}
                            onValueChange={(v) =>
                              setInvoiceMode(v as InvoiceTiming)
                            }
                          >
                            <SelectTrigger className="max-w-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="off">
                                {t("invoice_mode_off")}
                              </SelectItem>
                              <SelectItem value="now">
                                {t("invoice_mode_now")}
                              </SelectItem>
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
                        </>
                      )}

                      {!(workflowsOn && flowSendsInvoice(activeFlow)) &&
                        invoiceMode === "delayed" && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">
                              {t("invoice_delay_prefix")}
                            </span>
                            <Input
                              type="number"
                              min={1}
                              max={365}
                              value={invoiceDelayDays}
                              onChange={(e) =>
                                setInvoiceDelayDays(e.target.value)
                              }
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
                                  amount: (
                                    (invoiceDefaultCents ?? 0) / 100
                                  ).toFixed(2),
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
                            // ...and only when there is nothing to calculate from.
                            // "Enter the amount below" under a box that has already
                            // filled itself in is an instruction to redo work.
                            invoiceAutoAmount === "" && (
                              <p className="text-xs leading-snug text-muted-foreground">
                                {t("invoice_no_default_hint")}
                              </p>
                            )
                          )}
                          {(!invoiceUseDefault || !hasSavedPrice) && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-muted-foreground">
                                $
                              </span>
                              <Input
                                type="number"
                                min={0.5}
                                step={0.01}
                                value={invoiceAmountValue}
                                onChange={(e) => {
                                  setInvoiceAmountTouched(true);
                                  setInvoiceCustomAmount(e.target.value);
                                }}
                                placeholder="0.00"
                                className="w-32"
                                aria-label={t("invoice_amount_label")}
                              />
                            </div>
                          )}

                          {/* Where the number came from, and the way back to it.
                          A field that fills itself has to say so, or it reads
                          as something you left behind on a previous visit. */}
                          {(!invoiceUseDefault || !hasSavedPrice) &&
                            invoiceAutoAmount !== "" &&
                            (invoiceAmountTouched ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceAmountTouched(false);
                                  setInvoiceCustomAmount("");
                                }}
                                className="text-xs text-accent underline-offset-2 hover:underline"
                              >
                                {t("invoice_amount_reset", {
                                  amount: invoiceAutoAmount,
                                })}
                              </button>
                            ) : (
                              <p className="text-xs leading-snug text-muted-foreground">
                                {t("invoice_amount_from_services")}
                              </p>
                            ))}
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
                              onChange={(e) =>
                                setInvoiceDescription(e.target.value)
                              }
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
                              {invoiceAttachment?.name ??
                                t("invoice_attachment_choose")}
                            </label>
                            <input
                              id="automated-invoice-attachment"
                              type="file"
                              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                              className="sr-only"
                              onChange={(event) =>
                                setInvoiceAttachment(
                                  event.target.files?.[0] ?? null,
                                )
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
                              <span className="block">
                                {t("invoice_lock_label")}
                              </span>
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
        {/* ONE card, two homes — never a copy: its own step for unflagged
          firms, folded into the Automation step when flows are on (the
          founder: "the reminder thing will also be there"). */}
        {(step === "reminders" || (workflowsOn && step === "automation")) && (
          <>
            {/* Automatic reminders — its own top-level card. */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <BellRing
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
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
                    {reminderDefaultSettings ||
                    (workflowsOn && activeFlow?.reminders?.documents) ? (
                      <div className="grid gap-1.5 border-t border-border/60 pt-3 sm:grid-cols-[10rem_1fr] sm:items-center">
                        <Label
                          htmlFor="reminder-preset"
                          className="text-xs text-muted-foreground"
                        >
                          {t("reminder_preset_label")}
                        </Label>
                        <Select
                          value={reminderPreset}
                          onValueChange={(value) =>
                            applyReminderPreset(
                              value as "firm" | "vylan" | "custom" | "flow",
                            )
                          }
                        >
                          <SelectTrigger
                            id="reminder-preset"
                            className="max-w-sm"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* The flow's own cadence — the founder's named
                                preset. Offered whenever the active flow
                                carries one (and kept while selected, so the
                                control never shows an empty value). */}
                            {((workflowsOn &&
                              activeFlow?.reminders?.documents) ||
                              reminderPreset === "flow") && (
                              <SelectItem value="flow">
                                {t("reminder_preset_flow")}
                              </SelectItem>
                            )}
                            {reminderDefaultSettings && (
                              <SelectItem value="firm">
                                {t("reminder_preset_firm")}
                              </SelectItem>
                            )}
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          asChild
                        >
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
                                      updateReminderStep(step.tone, {
                                        repeatCount,
                                      })
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
                                        customSubject:
                                          event.target.value || null,
                                      })
                                    }
                                    placeholder={t(
                                      "reminder_subject_placeholder",
                                    )}
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
                                        customMessage:
                                          event.target.value || null,
                                      })
                                    }
                                    placeholder={t(
                                      "reminder_message_placeholder",
                                    )}
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
                                    terms:
                                      termsToPlainText(termsSections).trim(),
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
          </>
        )}
      </TemplateBuilderShell>
    </>
  );
}
