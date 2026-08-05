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
import { useRouter } from "@/i18n/navigation";
import {
  X,
  Eye,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import type { CatalogueService } from "@/components/engagements/engagement-items-editor";
import { ProposalPreview } from "@/components/engagements/proposal-preview";
import { BillingBlocksEditor } from "@/components/templates/billing-blocks-editor";
import { AssetUpload } from "@/components/templates/asset-upload";
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

// Canopy's four tabs, in Canopy's order.
const TABS = ["introduction", "services", "terms", "signatures"] as const;
type Tab = (typeof TABS)[number];

// Spelled out so a typo is a compile error rather than a `Templates.tab_x`
// rendering on screen — next-intl fails silently and this repo has been bitten
// by it twice.
type TabKey =
  | "tab_introduction"
  | "tab_services"
  | "tab_terms"
  | "tab_signatures";

// Which of the CLIENT's four steps each firm-facing tab is about. Written down
// rather than assumed, because the two lists are allowed to diverge later.
const TAB_TO_STEP: Record<Tab, "introduction" | "services" | "terms" | "sign"> =
  {
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

  const [tab, setTab] = useState<Tab>("introduction");
  const [previewOpen, setPreviewOpen] = useState(true);

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
  const [termsText, setTermsText] = useState(
    initial ? initial.payload.termsText : firmDefaultTerms,
  );

  const [clientSigns, setClientSigns] = useState(initial?.payload.clientSigns ?? true);
  const [additionalSignerLabels, setAdditionalSignerLabels] = useState<
    string[]
  >(initial?.payload.additionalSignerLabels ?? []);
  const [firmCountersigns, setFirmCountersigns] = useState(initial?.payload.firmCountersigns ?? false);
  const [depositRequired, setDepositRequired] = useState(initial?.payload.depositCents != null);
  const [depositAmount, setDepositAmount] = useState(initial?.payload.depositCents != null ? String(initial.payload.depositCents / 100) : "");

  const [error, setError] = useState<string | null>(null);
  const [termsSaved, setTermsSaved] = useState(false);

  // A template needs a name of its own AND a name for the engagements it makes.
  // Canopy marks both required, and it is right: without the second, every
  // engagement from this template would be called nothing.
  const introIncomplete = name.trim().length === 0 || title.trim().length === 0;
  const canSaveTemplate = !introIncomplete;
  // A DRAFT is deliberately allowed to be incomplete — Canopy's own wording is
  // "store incomplete work". It needs only a name, because a draft you cannot
  // find again is not saved in any useful sense.
  const canSaveDraft = name.trim().length > 0;

  const tabIndex = TABS.indexOf(tab);

  const depositCents = useMemo(() => {
    if (!depositRequired) return null;
    const n = Number(depositAmount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }, [depositRequired, depositAmount]);

  // What the client would see. Placeholders resolve against a SAMPLE client,
  // because a template has none — showing raw {{clientname}} in a panel meant
  // to answer "what will this look like" answers the wrong question.
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
          termsText: termsText.trim(),
          clientSigns,
          additionalSignerLabels: additionalSignerLabels
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
          firmCountersigns,
          depositCents,
          // The blocks are the authoring shape; `items` stays the flat source
          // of truth every other surface (totals, invoices) already reads.
          items: flattenBlocks(blocks),
          billingBlocks: blocks,
          priceVisibility: visibility,
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
      router.push("/templates/engagements");
    });
  }

  const periodLabel = (months: number | null) =>
    months == null ? t("period_ongoing") : t("period_months", { count: months });

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[38rem] flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated">
      {/* ── TITLE BAR ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h1 className="text-lg font-semibold tracking-tight">
          {initial ? t("edit_engagement_template") : t("create_engagement_template")}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canSaveDraft || pending}
            onClick={() => save(true)}
          >
            {t("save_draft")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSaveTemplate || pending}
            onClick={() => save(false)}
          >
            {t("save_template")}
          </Button>
          <button
            type="button"
            onClick={() => router.push("/templates/engagements")}
            aria-label={t("cancel")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* ── WHAT THIS SCREEN IS ───────────────────────────────────────────
          The founder: "when i try and create an engagement template its just
          the same as creating an engagement normally. It should be its own
          defined thing thats seperate from creating an engagement."

          They are right, and the reason is that the two forms ask overlapping
          questions. What actually differs is not the fields, it is the OBJECT:
          this makes a reusable shape, not a job. Nothing on the screen said so.
          Now the first thing on it does — and it names the two things a
          template deliberately has no answer for, which is what makes it a
          template rather than an engagement with the client left blank. */}
      <p className="border-b border-border bg-accent-subtle/40 px-5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        {t("template_builder_explainer")}
      </p>

      {/* ── TABS + PREVIEW TOGGLE ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5">
        <div
          role="tablist"
          aria-label={t("create_engagement_template")}
          className="flex items-center gap-1"
        >
          {TABS.map((key) => {
            const active = tab === key;
            const incomplete = key === "introduction" && introIncomplete;
            return (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={cn(
                  "relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
                  active
                    ? "border-accent font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`tab_${key}` as TabKey)}
                {/* Canopy's red mark on a tab whose required fields are empty.
                    Said in TEXT too, not colour alone — a red dot is invisible
                    to anyone who cannot see red. */}
                {incomplete && (
                  <span
                    className="ml-1.5 inline-block size-1.5 rounded-full bg-destructive align-middle"
                    aria-label={t("tab_incomplete")}
                  />
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          aria-pressed={previewOpen}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={previewOpen ? t("hide_preview") : t("show_preview")}
          title={previewOpen ? t("hide_preview") : t("show_preview")}
        >
          {previewOpen ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>

      {/* ── FORM (left) + PREVIEW (right) ─────────────────────────────── */}
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1",
          previewOpen && "lg:grid-cols-2",
        )}
      >
        <div className="flex min-h-0 flex-col border-border lg:border-r">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {tab === "introduction" && (
              <>
                <Fieldset title={t("template_details")}>
                  <Field
                    label={`${t("template_name_label")} *`}
                    htmlFor="tpl-name"
                  >
                    <Input
                      id="tpl-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("task_templates_name_placeholder")}
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(["team", "private"] as const).map((value) => (
                      <RadioCard
                        key={value}
                        name="tpl-access"
                        checked={access === value}
                        onSelect={() => setAccess(value)}
                        caption={t("template_access")}
                        label={
                          value === "team"
                            ? t("access_team")
                            : t("access_private")
                        }
                      />
                    ))}
                  </div>
                </Fieldset>

                <Fieldset title={t("engagement_details")}>
                  <Field
                    label={`${t("engagement_name_label")} *`}
                    htmlFor="tpl-title"
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

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(["acceptance", "custom"] as const).map((value) => (
                      <RadioCard
                        key={value}
                        name="tpl-period-start"
                        checked={periodStartsOn === value}
                        onSelect={() => setPeriodStartsOn(value)}
                        caption={t("period_begins_on")}
                        label={
                          value === "acceptance"
                            ? t("period_acceptance")
                            : t("period_custom_date")
                        }
                      />
                    ))}
                  </div>
                  {/* No date picker. A template reused next season must not
                      carry last season's start — the rule is stored, the date
                      is asked for when the engagement is created. */}
                  {periodStartsOn === "custom" && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("period_custom_hint")}
                    </p>
                  )}

                  <Field label={t("period_label")} htmlFor="tpl-period">
                    <select
                      id="tpl-period"
                      value={periodMonths == null ? "" : String(periodMonths)}
                      onChange={(e) =>
                        setPeriodMonths(
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
                    <Field label={t("assignees_label")} htmlFor="tpl-assignee">
                      <select
                        id="tpl-assignee"
                        value={assigneeIds[0] ?? ""}
                        onChange={(e) =>
                          setAssigneeIds(e.target.value ? [e.target.value] : [])
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
                </Fieldset>

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
              />
            )}

            {tab === "terms" && (
              <Fieldset title={t("tab_terms")}>
                <ToggleRow
                  label={t("general_terms")}
                  hint={t("general_terms_hint")}
                  on={termsEnabled}
                  onToggle={() => setTermsEnabled((v) => !v)}
                >
                  <div className="space-y-2">
                    <Textarea
                      value={termsText}
                      onChange={(e) => setTermsText(e.target.value)}
                      placeholder={t("general_terms_placeholder")}
                      rows={10}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Load the firm's standard terms. Shown only when there
                          are some AND the box does not already hold them, so
                          it never offers to do nothing. */}
                      {firmDefaultTerms.trim() &&
                        termsText.trim() !== firmDefaultTerms.trim() && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setTermsText(firmDefaultTerms)}
                          >
                            {t("use_firm_terms")}
                          </Button>
                        )}
                      {/* Save these AS the firm standard. Gated: writing terms
                          on one template is not the same act as changing what
                          every future template starts from. */}
                      {canManageFirmTerms &&
                        termsText.trim() &&
                        termsText.trim() !== firmDefaultTerms.trim() && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const res = await saveFirmDefaultTermsAction({
                                  terms: termsText.trim(),
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
                    </div>
                  </div>
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

                <ToggleRow
                  label={t("require_deposit")}
                  hint={t("require_deposit_hint")}
                  on={depositRequired}
                  onToggle={() => setDepositRequired((v) => !v)}
                >
                  <Input
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder={t("deposit_placeholder")}
                    inputMode="decimal"
                  />
                </ToggleRow>
              </Fieldset>
            )}

            {error && (
              <p className="text-xs text-destructive">
                {error === "needs_migration"
                  ? t("task_templates_needs_migration")
                  : error === "empty"
                    ? t("template_empty_error")
                    : t("task_templates_save_failed")}
              </p>
            )}
          </div>

          {/* ── BACK / NEXT ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={tabIndex === 0}
              onClick={() => setTab(TABS[tabIndex - 1])}
            >
              <ArrowLeft className="size-3.5" />
              {t("back")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={tabIndex === TABS.length - 1}
              onClick={() => setTab(TABS[tabIndex + 1])}
            >
              {t("next")}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>

        {previewOpen && (
          <div className="hidden min-h-0 justify-center overflow-y-auto bg-muted/30 p-5 lg:flex">
            {/* Labelled, because an unlabelled preview showing a client name
                reads as a real engagement — the exact confusion this screen is
                being made distinct from. */}
            <p className="mb-3 text-[11px] font-medium tracking-wide uppercase text-muted-foreground">
              {t("preview_sample_label")}
            </p>
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
                services: flattenBlocks(blocks).map((i) => ({
                  name: i.name,
                  rateCents: i.rateCents,
                })),
                terms: termsEnabled ? termsText : null,
                clientSigns,
                additionalSignerLabels: additionalSignerLabels.filter((s) =>
                  s.trim(),
                ),
                firmCountersigns,
                depositCents,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Fieldset({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-4 last:border-0">
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function RadioCard({
  name,
  checked,
  onSelect,
  caption,
  label,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  caption: string;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors",
        checked
          ? "border-accent bg-accent/5"
          : "border-border hover:border-border/80",
      )}
    >
      <input
        type="radio"
        name={name}
        className="mt-0.5"
        checked={checked}
        onChange={onSelect}
      />
      <span>
        <span className="block text-xs text-muted-foreground">{caption}</span>
        <span className="block text-sm font-medium">{label}</span>
      </span>
    </label>
  );
}

/**
 * Canopy's Introduction rows: a label, a one-line hint, a switch — and the
 * field itself only once the switch is on.
 *
 * The content is HIDDEN when the switch goes off, not unmounted. Turning Video
 * off and back on must not lose the link you already pasted, which is the
 * difference between a toggle and a delete.
 */
function ToggleRow({
  label,
  hint,
  on,
  onToggle,
  children,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          onClick={onToggle}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            on ? "bg-accent" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-background transition-[left]",
              on ? "left-[1.125rem]" : "left-0.5",
            )}
          />
        </button>
      </div>
      <div className={cn("pt-3", !on && "hidden")}>{children}</div>
    </div>
  );
}
