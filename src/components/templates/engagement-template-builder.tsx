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
import {
  EngagementItemsEditor,
  type CatalogueService,
} from "@/components/engagements/engagement-items-editor";
import { ProposalPreview } from "@/components/engagements/proposal-preview";
import type { EngagementItemDraft } from "@/lib/engagements/items";
import {
  resolvePlaceholders,
  PLACEHOLDERS,
  placeholderText,
} from "@/lib/engagements/placeholders";
import { saveEngagementAsTemplateAction } from "@/app/actions/engagement-templates";

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
}: {
  locale: "en" | "fr";
  services?: CatalogueService[];
  /** Active firm members, for the assignee picker. */
  members?: { id: string; name: string }[];
  fallbackTaxPct?: number | null;
}) {
  const t = useTranslations("Templates");
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("introduction");
  const [previewOpen, setPreviewOpen] = useState(true);

  const [name, setName] = useState("");
  const [access, setAccess] = useState<"team" | "private">("team");
  const [title, setTitle] = useState("");
  const [periodStartsOn, setPeriodStartsOn] = useState<"acceptance" | "custom">(
    "acceptance",
  );
  const [periodMonths, setPeriodMonths] = useState<number | null>(null);

  // Canopy's three Introduction rows. The toggle is kept separate from the
  // content so turning a row off does not lose what you already typed.
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [introMessage, setIntroMessage] = useState("");
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [documentEnabled, setDocumentEnabled] = useState(false);
  const [documentName, setDocumentName] = useState("");

  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [items, setItems] = useState<EngagementItemDraft[]>([]);

  const [termsEnabled, setTermsEnabled] = useState(false);
  const [termsText, setTermsText] = useState("");

  const [clientSigns, setClientSigns] = useState(true);
  const [additionalSignerLabels, setAdditionalSignerLabels] = useState<
    string[]
  >([]);
  const [firmCountersigns, setFirmCountersigns] = useState(false);
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");

  const [error, setError] = useState<string | null>(null);

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
          documentEnabled,
          documentName: documentName.trim(),
          assigneeIds,
          termsEnabled,
          termsText: termsText.trim(),
          clientSigns,
          additionalSignerLabels: additionalSignerLabels
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
          firmCountersigns,
          depositCents,
          items: items.filter((i) => i.name.trim().length > 0),
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
          {t("create_engagement_template")}
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
                    <Input
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder={t("intro_video_placeholder")}
                    />
                  </ToggleRow>
                  <ToggleRow
                    label={t("intro_document")}
                    hint={t("intro_document_hint")}
                    on={documentEnabled}
                    onToggle={() => setDocumentEnabled((v) => !v)}
                  >
                    <Input
                      value={documentName}
                      onChange={(e) => setDocumentName(e.target.value)}
                      placeholder={t("intro_document_placeholder")}
                    />
                  </ToggleRow>
                </Fieldset>
              </>
            )}

            {tab === "services" && (
              // IMPORTED, not rebuilt. The same priced-scope editor the
              // engagement builder uses — same rounding, same catalogue picker,
              // same totals. A second copy is how the two would start
              // disagreeing about money.
              <EngagementItemsEditor
                items={items}
                onChange={setItems}
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
                  <Textarea
                    value={termsText}
                    onChange={(e) => setTermsText(e.target.value)}
                    placeholder={t("general_terms_placeholder")}
                    rows={10}
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
          <div className="hidden min-h-0 overflow-y-auto bg-muted/30 p-5 lg:block">
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
                services: items.map((i) => ({
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
