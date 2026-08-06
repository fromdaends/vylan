"use client";

// Create Engagement Template — Canopy's builder, in Vylan's colours.
//
// ── WHY THIS IS ITS OWN COMPONENT ──────────────────────────────────────────
//
// The founder, correcting an earlier plan to make this a `mode` prop on
// EngagementBuilder: "Woah its not a mode switch. Theres a builder for
// engagements and theres one for templates both different. However very
// similar."
//
// They are right, and it matches Canopy. The two screens ask different
// questions — a template has no client and no due date, and its period is a
// RULE rather than a date — and they are laid out differently.
//
// ── WHAT "NOT A DUPLICATE" MEANS HERE ──────────────────────────────────────
//
// The founder ALSO said "you wouldnt be building a duplicate builder". Both are
// true: two screens, not two copies of the parts. Everything that is genuinely
// the same object is imported — EngagementItemsEditor for the priced scope, the
// placeholder resolver, ProposalPreview for what the client sees, the same save
// action and the same payload reader. What lives here is only this screen's
// chrome and its fields.
//
// ── WHY ALL FOUR TABS ──────────────────────────────────────────────────────
//
// Terms and Signatures were parked with the proposal. The founder un-parked
// them — "Build the full canopy thing... this is going to lead into the
// proposal creation too" — and that reframing is the reason: these tabs are not
// decoration ahead of the proposal, they are where the proposal's contents get
// authored. The panel on the right IS the proposal.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogueService } from "@/components/engagements/engagement-items-editor";
import { ProposalPreview } from "@/components/engagements/proposal-preview";
import { BillingBlocksEditor } from "@/components/templates/billing-blocks-editor";
// The SAME readout the engagement's Billing step renders, from the same
// computeBillingTotals — the founder: "Dont make the same mistake again of
// building new stuff on the engagement builder but not transferring it over to
// other places it exists."
import { BillingTotalsPanel } from "@/components/engagements/billing-totals-panel";
import { computeBillingTotals } from "@/lib/engagements/billing-totals";
// ONE chrome for every builder — see the note at the top of that file.
import {
  TemplateBuilderShell,
  Fieldset,
  Field,
  Segmented,
  ToggleRow,
  WizardHint,
} from "@/components/templates/template-builder-shell";
import { AssetUpload } from "@/components/templates/asset-upload";
import { TermsSectionsEditor } from "@/components/engagements/terms-sections-editor";
import {
  termsToPlainText,
  type TermsSection,
} from "@/lib/engagements/terms-sections";
import { MoneyInput } from "@/components/ui/money-input";
import { saveFirmDefaultTermsAction } from "@/app/actions/firm-terms";
import {
  defaultPriceVisibility,
  flattenBlocks,
  type BillingBlock,
  type PriceVisibility,
} from "@/lib/engagements/billing-blocks";
import {
  resolvePlaceholders,
  PLACEHOLDERS,
  placeholderText,
} from "@/lib/engagements/placeholders";
import { saveEngagementAsTemplateAction } from "@/app/actions/engagement-templates";
import type { EngagementTemplatePayload } from "@/lib/engagements/template-payload";

// FIVE steps now, not four.
//
// "Basics" is new, and it is a split rather than an addition: naming the
// template and shaping the engagements it makes used to share a tab with the
// welcome message, the video and the brochure. Those are two different
// questions — what this thing IS, and what greets your client — and putting
// them in one scroll is what made the first screen of the old builder the
// longest one.
const TABS = [
  "basics",
  "introduction",
  "services",
  "terms",
  "signatures",
] as const;
type Tab = (typeof TABS)[number];

// Spelled out so a typo is a compile error rather than a `Templates.tab_x`
// rendering on screen — next-intl fails silently and this repo has been bitten
// by it twice.
type TabKey =
  | "tab_basics"
  | "tab_introduction"
  | "tab_services"
  | "tab_terms"
  | "tab_signatures";

type StepDescKey =
  | "step_desc_basics"
  | "step_desc_introduction"
  | "step_desc_services"
  | "step_desc_terms"
  | "step_desc_signatures";

// Which of the CLIENT's four steps each firm-facing step is about. Written down
// rather than assumed, because the two lists are allowed to diverge later —
// and they already have: Basics and Introduction both point at the client's
// first dot, since naming the job is part of the introduction from where the
// client is standing.
const TAB_TO_STEP: Record<Tab, "introduction" | "services" | "terms" | "sign"> =
  {
    basics: "introduction",
    introduction: "introduction",
    services: "services",
    terms: "terms",
    signatures: "sign",
  };

// Canopy's period dropdown. Null is their "Ongoing", the honest default for
// bookkeeping — the work does not stop on a date.
const PERIOD_OPTIONS: (number | null)[] = [null, 1, 3, 6, 12, 24];

export function EngagementTemplateBuilder({
  locale,
  services = [],
  taskTemplates = [],
  members = [],
  fallbackTaxPct = null,
  initial,
  firmDefaultTerms = "",
  canManageFirmTerms = false,
}: {
  locale: "en" | "fr";
  /**
   * An existing template being EDITED. Absent when creating.
   *
   * Every field below seeds from it directly rather than through an effect: a
   * mount effect that called a dozen setters would render the empty form first
   * and correct it a frame later, which reads as the page losing your work.
   */
  initial?: {
    id: string;
    name: string;
    access: "team" | "private";
    payload: EngagementTemplatePayload;
  };
  services?: CatalogueService[];
  /** The firm's task templates (1570), so the Services tab can show the work a
   *  picked service brings — and so an edited template can name it back. */
  taskTemplates?: { id: string; name: string; steps: string[] }[];
  /** Active firm members, for the assignee picker. */
  members?: { id: string; name: string }[];
  fallbackTaxPct?: number | null;
  /** The firm's standard terms (1610), loaded into a NEW template's Terms tab
   *  so nobody retypes them. Copied, never referenced — editing the firm
   *  default must not rewrite terms a client already agreed to. */
  firmDefaultTerms?: string;
  /** Whether this person may CHANGE the firm's standard terms. Writing terms
   *  onto one template is not the same act as changing what every future
   *  template starts from. */
  canManageFirmTerms?: boolean;
}) {
  const t = useTranslations("Templates");
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("basics");

  const [name, setName] = useState(initial?.name ?? "");
  const [access, setAccess] = useState<"team" | "private">(initial?.access ?? "team");
  const [title, setTitle] = useState(initial?.payload.title ?? "");
  const [periodStartsOn, setPeriodStartsOn] = useState<"acceptance" | "custom">(
    initial?.payload.periodStartsOn ?? "acceptance",
  );
  const [periodMonths, setPeriodMonths] = useState<number | null>(initial?.payload.periodMonths ?? null);

  // Canopy's three Introduction rows. The toggle is kept separate from the
  // content so turning a row off does not lose what you already typed.
  const [welcomeEnabled, setWelcomeEnabled] = useState(initial?.payload.welcomeEnabled ?? false);
  const [introMessage, setIntroMessage] = useState(initial?.payload.introMessage ?? "");
  const [videoEnabled, setVideoEnabled] = useState(initial?.payload.videoEnabled ?? false);
  const [videoUrl, setVideoUrl] = useState(initial?.payload.videoUrl ?? "");
  const [videoPath, setVideoPath] = useState(initial?.payload.videoPath ?? "");
  const [videoFileName, setVideoFileName] = useState(initial?.payload.videoFileName ?? "");
  const [documentEnabled, setDocumentEnabled] = useState(initial?.payload.documentEnabled ?? false);
  const [documentName, setDocumentName] = useState(initial?.payload.documentName ?? "");
  const [documentPath, setDocumentPath] = useState(initial?.payload.documentPath ?? "");

  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.payload.assigneeIds ?? []);
  // Canopy's billing blocks. Seeded from the template, or from ONE block
  // holding whatever flat items it already had — a template written before
  // blocks existed opens with its services intact rather than empty.
  const [blocks, setBlocks] = useState<BillingBlock[]>(() => {
    const saved = initial?.payload.billingBlocks ?? [];
    if (saved.length > 0) return saved.map((b) => ({ ...b, items: [...b.items] }));
    const flat = initial?.payload.items ?? [];
    if (flat.length === 0) return [];
    return [
      {
        billingType: "one_time" as const,
        timing: "on_acceptance" as const,
        frequency: "monthly" as const,
        combineItems: false,
        clientNote: "",
        items: [...flat],
      },
    ];
  });
  const [visibility, setVisibility] = useState<PriceVisibility>(
    initial?.payload.priceVisibility ?? defaultPriceVisibility(),
  );

  const [termsEnabled, setTermsEnabled] = useState(
    initial?.payload.termsEnabled ?? firmDefaultTerms.trim().length > 0,
  );
  // A NEW template starts from the firm's standard terms; an existing one keeps
  // its own, because its terms may already be what a client agreed to.
  // Sections, not one box. A NEW template starts from the firm's standard
  // terms as a single untitled section — the same head start the old single
  // textarea gave, in the new shape.
  const [termsSections, setTermsSections] = useState<TermsSection[]>(() => {
    if (initial) return initial.payload.termsSections;
    return firmDefaultTerms.trim()
      ? [{ heading: "", body: firmDefaultTerms }]
      : [];
  });

  const [clientSigns, setClientSigns] = useState(initial?.payload.clientSigns ?? true);
  const [additionalSignerLabels, setAdditionalSignerLabels] = useState<
    string[]
  >(initial?.payload.additionalSignerLabels ?? []);
  const [firmCountersigns, setFirmCountersigns] = useState(initial?.payload.firmCountersigns ?? false);
  const [depositRequired, setDepositRequired] = useState(initial?.payload.depositCents != null);
  /** Who settles the deposit — the client, or one of the named signer ROLES.
   *  A template never names a person; the person is chosen at creation. */
  const [depositPayer, setDepositPayer] = useState(
    initial?.payload.depositPayer ?? "",
  );
  const [requirePaymentMethod, setRequirePaymentMethod] = useState(
    initial?.payload.requirePaymentMethod ?? false,
  );
  const [depositAmount, setDepositAmount] = useState(initial?.payload.depositCents != null ? String(initial.payload.depositCents / 100) : "");

  const [error, setError] = useState<string | null>(null);
  const [termsSaved, setTermsSaved] = useState(false);

  // A template needs a name of its own AND a name for the engagements it makes.
  // Canopy marks both required, and it is right: without the second, every
  // engagement from this template would be called nothing.
  // Both live on Basics now, which is where the red mark has to land — it used
  // to point at Introduction because that is where the fields used to be.
  const basicsIncomplete = name.trim().length === 0 || title.trim().length === 0;
  const canSaveTemplate = !basicsIncomplete;
  // A DRAFT is deliberately allowed to be incomplete — Canopy's own wording is
  // "store incomplete work". It needs only a name, because a draft you cannot
  // find again is not saved in any useful sense.
  const canSaveDraft = name.trim().length > 0;


  const depositCents = useMemo(() => {
    if (!depositRequired) return null;
    const n = Number(depositAmount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }, [depositRequired, depositAmount]);

  // ── THE WORK THE SERVICES BRING (1620) ──────────────────────────────────
  //
  // The founder: "when creating an engagement template on the services tab you
  // didnt change it to accomodate for the new service and tasks link."
  //
  // Right — a service knows which task template it implies, and the engagement
  // builder already pulls that in automatically. A TEMPLATE did not, so a
  // template built out of services produced priced lines and no work.
  //
  // IDS, not copies: task templates are a catalogue and a catalogue stays live.
  // The tasks are frozen when an engagement is actually created from this.
  const [taskTemplateIds, setTaskTemplateIds] = useState<string[]>(
    initial?.payload.taskTemplateIds ?? [],
  );

  /** Picking a service on the Services tab brings its work with it — no prompt.
   *  The founder: "there should be no prompt. It should happen automatically
   *  when the tasks get pulled in." */
  function pullServiceWork(service: CatalogueService) {
    const id = service.work?.templateId;
    if (!id) return;
    setTaskTemplateIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  /** The work, resolved for display. An id whose template has since been
   *  deleted simply drops out — nothing here may assume it resolves. */
  const linkedWork = useMemo(
    () =>
      taskTemplateIds
        .map((id) => taskTemplates.find((x) => x.id === id))
        .filter((x): x is NonNullable<typeof x> => x != null),
    [taskTemplateIds, taskTemplates],
  );

  // What the client would see. Placeholders resolve against a SAMPLE client,
  // because a template has none — showing raw {{clientname}} in a panel meant
  // to answer "what will this look like" answers the wrong question.
  // Flattened first: blocks are the AUTHORING shape, and the flat lines are
  // what every other surface (totals, invoices, the proposal) consumes. Totalling
  // the blocks directly would be a second definition of the same sum.
  const templateTotals = computeBillingTotals(flattenBlocks(blocks), {
    depositCents,
  });

  const previewTitle = useMemo(
    () =>
      resolvePlaceholders(
        title,
        { clientName: t("preview_sample_client"), taxYear: null },
        new Date(),
        locale,
      ),
    [title, locale, t],
  );

  function save(asDraft: boolean) {
    if (asDraft ? !canSaveDraft : !canSaveTemplate) return;
    setError(null);
    startTransition(async () => {
      const res = await saveEngagementAsTemplateAction({
        // Present => update. Absent => create. Without this, editing would
        // leave the original behind as a duplicate.
        ...(initial ? { id: initial.id } : {}),
        name: name.trim(),
        access,
        payload: {
          title: title.trim(),
          periodStartsOn,
          periodMonths,
          isDraft: asDraft,
          welcomeEnabled,
          introMessage: introMessage.trim(),
          videoEnabled,
          videoUrl: videoUrl.trim(),
          videoPath,
          videoFileName,
          documentEnabled,
          documentName: documentName.trim(),
          documentPath,
          assigneeIds,
          termsEnabled,
          // Sections are the truth; the legacy string is left empty on new
          // writes so nothing has two places to disagree.
          termsText: "",
          termsSections,
          clientSigns,
          additionalSignerLabels: additionalSignerLabels
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
          firmCountersigns,
          depositCents,
          requirePaymentMethod,
          depositPayer,
          // The blocks are the authoring shape; `items` stays the flat source
          // of truth every other surface (totals, invoices) already reads.
          items: flattenBlocks(blocks),
          billingBlocks: blocks,
          priceVisibility: visibility,
          // Only ids that still resolve. Saving a dangling one would keep a
          // deleted template's ghost alive in every template that named it.
          taskTemplateIds: linkedWork.map((x) => x.id),
        },
        // A draft skips the "is this worth saving" check — half-written IS the
        // point of a draft.
        allowIncomplete: asDraft,
      });
      if (!res.ok) {
        setError(
          res.needsMigration
            ? "needs_migration"
            : res.error === "empty"
              ? "empty"
              : "failed",
        );
        return;
      }
      // Hand the listing three things: which tab this landed in, and which row
      // to flash. A save that drops you on an unfiltered list of thirty makes
      // you hunt for the thing you just made — and on the wrong tab it reads as
      // a save that did not happen.
      const landedIn = asDraft ? "draft" : access;
      const params = new URLSearchParams({ tab: landedIn });
      if (res.id) params.set("saved", res.id);
      toast.success(
        asDraft
          ? t("draft_saved_toast")
          : t("template_saved_toast", {
              access: access === "team" ? t("access_team") : t("access_private"),
            }),
      );
      router.push(`/templates/engagements?${params}`);
    });
  }

  const periodLabel = (months: number | null) =>
    months == null ? t("period_ongoing") : t("period_months", { count: months });

  return (
    <TemplateBuilderShell
      // The KIND above the name. "Create engagement template" on its own reads
      // the same as the other three wizards at a glance; the kicker is what
      // tells you which room you are in before you have read anything.
      kicker={t("kicker_engagement_template")}
      title={
        initial
          ? t("edit_engagement_template")
          : t("create_engagement_template")
      }
      // The founder: "when i try and create an engagement template its just the
      // same as creating an engagement normally. It should be its own defined
      // thing thats seperate from creating an engagement." What actually
      // differs is not the fields, it is the OBJECT — so the screen says so.
      explainer={t("template_builder_explainer")}
      tabs={TABS.map((key) => ({
        key,
        label: t(`tab_${key}` as TabKey),
        description: t(`step_desc_${key}` as StepDescKey),
        incomplete: key === "basics" && basicsIncomplete,
      }))}
      activeTab={tab}
      onTabChange={(key) => setTab(key as Tab)}
      // Save draft is the only thing in the header, and only here: this is the
      // one flow long enough that leaving half-way through is a normal thing
      // to do rather than an abandonment.
      headerActions={[
        {
          label: t("save_draft"),
          variant: "outline" as const,
          disabled: !canSaveDraft || pending,
          onClick: () => save(true),
        },
      ]}
      finalAction={{
        label: t("save_template"),
        disabled: !canSaveTemplate || pending,
        onClick: () => save(false),
      }}
      onClose={() => router.push("/templates/engagements")}
      previewLabel={t("preview_sample_label")}
      error={
        error
          ? error === "needs_migration"
            ? t("task_templates_needs_migration")
            : error === "empty"
              ? t("template_empty_error")
              : t("task_templates_save_failed")
          : null
      }
      // The label lives on the preview CARD's header now — an unlabelled
      // preview showing a client name reads as a real engagement, which is the
      // exact confusion this screen is being made distinct from.
      preview={
        <div className="mx-auto flex max-w-md flex-col items-center">
          <ProposalPreview
            locale={locale}
            activeStep={TAB_TO_STEP[tab]}
            data={{
              clientName: t("preview_sample_client"),
              engagementName: previewTitle,
              periodStartsOn,
              periodMonths,
              welcome: welcomeEnabled ? introMessage : null,
              videoUrl: videoEnabled ? videoUrl : null,
              documentName: documentEnabled ? documentName : null,
              // Carried so the frozen proposal knows which uploaded file the
              // client was promised, not just its name.
              videoPath: videoEnabled ? videoPath || null : null,
              documentPath: documentEnabled ? documentPath || null : null,
              // The work rides on the FIRST line only. It belongs to the
              // template as a whole (services were picked across blocks and
              // only their ids survive), and repeating the same six steps under
              // every priced line would read as six jobs rather than one.
              services: flattenBlocks(blocks).map((i, idx) => ({
                name: i.name,
                rateCents: i.rateCents,
                billingFrequency: i.billingFrequency,
                taxPct: i.taxPct,
                work:
                  idx === 0
                    ? linkedWork.flatMap((w) => w.steps)
                    : undefined,
              })),
              termsSections: termsEnabled ? termsSections : [],
              clientSigns,
              additionalSignerLabels: additionalSignerLabels.filter((x) =>
                x.trim(),
              ),
              firmCountersigns,
              depositCents,
              priceVisibility: visibility,
            }}
          />
        </div>
      }
    >
            {tab === "basics" && (
              <>
                <Fieldset title={t("template_details")}>
                  {/* Two columns, because a name and a two-word access choice
                      are one decision wide between them — the full-width stack
                      they replace made naming a template feel like a form. */}
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <Field
                      label={t("template_name_label")}
                      htmlFor="tpl-name"
                      required
                    >
                      <Input
                        id="tpl-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("task_templates_name_placeholder")}
                      />
                    </Field>
                    <Field label={t("template_access")}>
                      <Segmented
                        value={access}
                        onChange={setAccess}
                        label={t("template_access")}
                        options={[
                          { value: "team" as const, label: t("access_team") },
                          {
                            value: "private" as const,
                            label: t("access_private"),
                          },
                        ]}
                      />
                    </Field>
                  </div>
                </Fieldset>

                <Fieldset title={t("engagement_details")}>
                  <Field
                    label={t("engagement_name_label")}
                    htmlFor="tpl-title"
                    required
                  >
                    <Input
                      id="tpl-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("engagement_name_placeholder")}
                    />
                    {/* The tokens are BUTTONS, not a hint to type "{{". Canopy
                        tells you to type it; a click cannot be mistyped. */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        {t("placeholder_hint")}
                      </span>
                      {PLACEHOLDERS.map((token) => (
                        <button
                          key={token}
                          type="button"
                          onClick={() =>
                            setTitle((prev) => prev + placeholderText(token))
                          }
                          className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                        >
                          {tEng(
                            `placeholder_${token}` as "placeholder_clientname",
                          )}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <Field
                      label={t("period_begins_on")}
                      // No date picker, here or anywhere on a template. One
                      // reused next season must not carry last season's start —
                      // the RULE is stored, the date is asked for when an
                      // engagement is created.
                      hint={
                        periodStartsOn === "custom"
                          ? t("period_custom_hint")
                          : undefined
                      }
                    >
                      <Segmented
                        value={periodStartsOn}
                        onChange={setPeriodStartsOn}
                        label={t("period_begins_on")}
                        options={[
                          {
                            value: "acceptance" as const,
                            label: t("period_acceptance"),
                          },
                          {
                            value: "custom" as const,
                            label: t("period_custom_date"),
                          },
                        ]}
                      />
                    </Field>

                    <Field label={t("period_label")} htmlFor="tpl-period">
                      <select
                        id="tpl-period"
                        value={periodMonths == null ? "" : String(periodMonths)}
                        onChange={(e) =>
                          setPeriodMonths(
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[13.5px]"
                      >
                        {PERIOD_OPTIONS.map((months) => (
                          <option
                            key={months ?? "ongoing"}
                            value={months == null ? "" : String(months)}
                          >
                            {periodLabel(months)}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {/* Hidden in a solo firm — there is nobody else to hand it
                        to, so the control would be a dead end. */}
                    {members.length > 0 && (
                      <Field
                        label={t("assignees_label")}
                        htmlFor="tpl-assignee"
                      >
                        <select
                          id="tpl-assignee"
                          value={assigneeIds[0] ?? ""}
                          onChange={(e) =>
                            setAssigneeIds(
                              e.target.value ? [e.target.value] : [],
                            )
                          }
                          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[13.5px]"
                        >
                          <option value="">{tEng("task_assignee_none")}</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                </Fieldset>
              </>
            )}

            {tab === "introduction" && (
              <>
                <WizardHint>{t("step_desc_introduction")}</WizardHint>
                <Fieldset title={t("tab_introduction")}>
                  <ToggleRow
                    label={t("welcome_message")}
                    hint={t("welcome_message_hint")}
                    on={welcomeEnabled}
                    onToggle={() => setWelcomeEnabled((v) => !v)}
                  >
                    <Textarea
                      value={introMessage}
                      onChange={(e) => setIntroMessage(e.target.value)}
                      placeholder={tEng("intro_message_placeholder")}
                      rows={4}
                    />
                  </ToggleRow>
                  <ToggleRow
                    label={t("intro_video")}
                    hint={t("intro_video_hint")}
                    on={videoEnabled}
                    onToggle={() => setVideoEnabled((v) => !v)}
                  >
                    <div className="space-y-2">
                      <Input
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        placeholder={t("intro_video_placeholder")}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {t("or_upload")}
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
                    label={t("intro_document")}
                    hint={t("intro_document_hint")}
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
                </Fieldset>
              </>
            )}

            {tab === "services" && (
              // Canopy's Services tab: blocks, each with a billing rule, each
              // holding services edited by the SAME items editor the engagement
              // builder uses.
              <BillingBlocksEditor
                blocks={blocks}
                onChange={setBlocks}
                visibility={visibility}
                onVisibilityChange={setVisibility}
                locale={locale}
                services={services}
                fallbackTaxPct={fallbackTaxPct}
                onServicePicked={pullServiceWork}
              />
            )}

            {/* What the shape adds up to. A template has no client, but it
                absolutely has prices — and "what does this package come to"
                is the question you are answering while you build one. */}
            {/* ── THE WORK THESE SERVICES BRING (1620) ───────────────────
                On the SAME tab as the services, because it is not a separate
                decision — it is the other half of what a service is.

                It appears by itself when a service that carries work is picked,
                and the picker BELOW the list adds one directly, the way the
                engagement's Tasks step does. Canopy puts its "+ Add task
                template" under the box of rows, not in the header — the founder:
                "it sits below the actual box in the canopy screenshot... And,
                also, once again, fix it in the template builder as well."

                Removable: the work came with the service, but this template is
                allowed to disagree. */}
            {tab === "services" && (
              <Fieldset title={t("template_work_title")}>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("template_work_hint")}
                </p>
                {linkedWork.length > 0 && (
                  <ul className="space-y-2">
                    {linkedWork.map((work) => (
                      <li
                        key={work.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{work.name}</p>
                          {work.steps.length > 0 && (
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                              {work.steps.slice(0, 6).join(" · ")}
                              {work.steps.length > 6 &&
                                ` +${work.steps.length - 6}`}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setTaskTemplateIds((prev) =>
                              prev.filter((x) => x !== work.id),
                            )
                          }
                          aria-label={t("remove")}
                          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Under the list, like Canopy's. Hidden when the firm has no
                    task templates — a dropdown whose only entry is its own
                    placeholder is a control that does nothing. */}
                {taskTemplates.length > 0 && (
                  <select
                    // Reset after each pick so the same template can be added
                    // again; a select already holding the value fires no change.
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      setTaskTemplateIds((prev) =>
                        prev.includes(id) ? prev : [...prev, id],
                      );
                    }}
                    aria-label={tEng("apply_task_template")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">{tEng("apply_task_template")}</option>
                    {taskTemplates.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.name}
                      </option>
                    ))}
                  </select>
                )}
              </Fieldset>
            )}

            {tab === "services" && templateTotals.groups.length > 0 && (
              <Fieldset title={tEng("totals_section")}>
                <BillingTotalsPanel totals={templateTotals} locale={locale} />
              </Fieldset>
            )}

            {/* Canopy's Payment settings, in the same place the engagement
                keeps them. The deposit moved here off the Signatures tab:
                it is money, and one concept gets one home. */}
            {/* ── THE SAME PAYMENT CARD AS THE ENGAGEMENT BUILDER ──────
                Canopy's Payment settings: a checkbox, a labelled amount, and
                who pays it — every label at the same left edge, one gap between
                rows, no rules cutting the card into pieces. The founder, on the
                engagement's version: "clean up the billing screen its
                completely misalligned" — and then: "ALSO REMEBER TO UPDATE THE
                TEMPLATE BUILDER AT THE SAME TIME." */}
            {tab === "services" && (
              <Fieldset title={tEng("payment_settings")}>
                <div className="space-y-1.5">
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={requirePaymentMethod}
                      onChange={(e) => setRequirePaymentMethod(e.target.checked)}
                    />
                    {tEng("require_payment_method")}
                  </label>
                  <p className="pl-6 text-[11px] leading-relaxed text-muted-foreground">
                    {tEng("require_payment_method_hint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="tpl-deposit"
                    className="block text-sm font-medium"
                  >
                    {t("require_deposit")}
                  </label>
                  <MoneyInput
                    id="tpl-deposit"
                    valueCents={depositCents}
                    onChangeCents={(cents) => {
                      setDepositRequired(cents != null);
                      setDepositAmount(cents == null ? "" : String(cents / 100));
                    }}
                    placeholder={t("deposit_placeholder")}
                    className="max-w-[16rem]"
                  />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t("require_deposit_hint")}
                  </p>
                </div>

                {/* Canopy's "Signer responsible for making payment". A template
                    names the ROLE, never a person — the same rule its signer
                    slots follow. */}
                {depositCents != null && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="tpl-payer"
                      className="block text-sm font-medium"
                    >
                      {tEng("signer_pays_label")}
                    </label>
                    <select
                      id="tpl-payer"
                      value={depositPayer}
                      onChange={(e) => setDepositPayer(e.target.value)}
                      className="h-9 w-full max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">{tEng("signer_pays_client")}</option>
                      {additionalSignerLabels
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
              </Fieldset>
            )}

            {tab === "terms" && (
              <Fieldset title={t("tab_terms")}>
                <ToggleRow
                  label={t("general_terms")}
                  hint={t("general_terms_hint")}
                  on={termsEnabled}
                  onToggle={() => setTermsEnabled((v) => !v)}
                >
                  {/* Labelled SECTIONS, not one box. The founder: "you can have
                      multiple sections for the terms... you can create boxes
                      and label them differently."

                      The same editor the engagement builder's Proposal step
                      renders — one component, so the two cannot drift. */}
                  <TermsSectionsEditor
                    sections={termsSections}
                    onChange={setTermsSections}
                    actions={
                      <>
                        {/* Load the firm's standard terms as a section. Shown
                            only when there are some and they are not already
                            here, so it never offers to do nothing. */}
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
                              {t("use_firm_terms")}
                            </Button>
                          )}
                        {/* Save these AS the firm standard. Gated: writing
                            terms on one template is not the same act as
                            changing what every future one starts from.
                            Flattened to text, because the firm default is a
                            single string until it earns its own shape. */}
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
                              {t("save_as_firm_terms")}
                            </Button>
                          )}
                        {termsSaved && (
                          <span className="text-[11px] text-muted-foreground">
                            {t("firm_terms_saved")}
                          </span>
                        )}
                      </>
                    }
                  />
                </ToggleRow>
              </Fieldset>
            )}

            {tab === "signatures" && (
              <Fieldset title={t("who_signs")}>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("who_signs_hint")}
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={clientSigns}
                    onChange={(e) => setClientSigns(e.target.checked)}
                  />
                  {t("signer_client")}
                </label>

                {additionalSignerLabels.map((label, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={label}
                      onChange={(e) =>
                        setAdditionalSignerLabels((prev) =>
                          prev.map((s, i) => (i === idx ? e.target.value : s)),
                        )
                      }
                      placeholder={t("signer_slot_placeholder")}
                      aria-label={t("signer_slot_placeholder")}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAdditionalSignerLabels((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      aria-label={t("remove")}
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
                  onClick={() =>
                    setAdditionalSignerLabels((prev) => [...prev, ""])
                  }
                >
                  <Plus className="size-3.5" />
                  {t("add_signer")}
                </Button>

                <label className="flex cursor-pointer items-center gap-2 border-t border-border/60 pt-3 text-sm">
                  <input
                    type="checkbox"
                    checked={firmCountersigns}
                    onChange={(e) => setFirmCountersigns(e.target.checked)}
                  />
                  {t("signer_firm")}
                </label>

              </Fieldset>
            )}
    </TemplateBuilderShell>
  );
}

