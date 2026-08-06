"use client";

// What the CLIENT sees — the proposal.
//
// ── WHY THIS IS ITS OWN COMPONENT ──────────────────────────────────────────
//
// The founder, while the template builder was being built: "this is going to
// lead into the proposal creation too."
//
// Exactly right, and it changes where this code belongs. The welcome message,
// the video, the document, the priced services, the terms and the signature
// block ARE the proposal. The panel on the right of the template builder is not
// a mock-up of the proposal — it is the proposal, rendered from a template
// instead of from a real engagement.
//
// So it lives here rather than inside the builder, and it takes plain data. The
// real client-facing proposal renders the same component from a real
// engagement: same sections, same order, same empty states, one place to change
// how a proposal looks. Building it inside the builder would have guaranteed
// two proposals that drift.
//
// ── THE FOUR STEPS ─────────────────────────────────────────────────────────
//
// Canopy's preview carries its own progress: 1 Introduction · 2 Services ·
// 3 Terms · 4 Sign. They are the CLIENT's journey through the document, not the
// firm's tabs — which is why there are four of them even though the firm's
// builder has its own idea of how many screens it takes to fill in.

import { useTranslations } from "next-intl";
import { ChevronRight, FileText, PlayCircle, PenLine } from "lucide-react";
import { cn } from "@/lib/cn";
import { computeBillingTotals } from "@/lib/engagements/billing-totals";
import { readTermsSections } from "@/lib/engagements/terms-sections";
import { BillingTotalsPanel } from "@/components/engagements/billing-totals-panel";
import type { BillingFrequency } from "@/lib/engagements/items";

export type ProposalPreviewData = {
  clientName: string;
  /** Already resolved — placeholders belong to the caller, not to the view. */
  engagementName: string;
  periodStartsOn: "acceptance" | "custom";
  periodMonths: number | null;
  welcome: string | null;
  videoUrl: string | null;
  documentName: string | null;
  /**
   * Storage paths for an UPLOADED video / document, when the firm attached a
   * file instead of pasting a link.
   *
   * The file's NAME is derived from these so an uploaded intro is at least
   * visible. They are also what the frozen snapshot uses to know which file the
   * client was promised; dropping them would make the uploader write to nothing.
   */
  videoPath?: string | null;
  documentPath?: string | null;
  /**
   * Short-lived signed URLs for those uploads, resolved by whoever renders this.
   *
   * Absent in the BUILDER's preview — the firm is looking at a thumbnail and the
   * file is theirs already. Present on the CLIENT's copy, signed by
   * loadPortalContext alongside the client's own files, using the same batch
   * signer rather than a new file route: no second way to hand out a storage
   * object, and no new surface to get the authorisation wrong on.
   *
   * Absent renders as plain text, never a dead link.
   */
  videoHref?: string | null;
  documentHref?: string | null;
  /**
   * The priced lines, each with the WORK it brings (1620).
   *
   * `work` is what the client is actually buying — "Monthly bookkeeping" means
   * nothing until it says which six things get done. The founder, on the
   * service→task link: "make them link sensably for the user", and then: this
   * "also relates to the proposal the client sees."
   *
   * Optional, and empty is normal: plenty of services are a price and nothing
   * else, and a proposal written before this existed has none.
   */
  services: {
    name: string;
    rateCents: number | null;
    work?: string[];
    /** Carried so the CLIENT's own copy can total itself the same way the
     *  builder did — rather than the builder storing a number the document
     *  then has to be trusted to have computed correctly. */
    billingFrequency?: BillingFrequency;
    taxPct?: number | null;
  }[];
  /**
   * Canopy's "Hide itemized rates on the proposal" gear.
   *
   * Absent means show everything. A client who cannot see what they are paying
   * for is the surprising default, not the safe one — and a proposal written
   * before this existed showed every figure, so that is what it must keep
   * doing.
   */
  priceVisibility?: { itemizedPrice: boolean; blockTotals: boolean; total: boolean };
  /** LEGACY — a single block of terms. Still read so a proposal frozen before
   *  sections existed renders exactly as it did. */
  terms?: string | null;
  /** Terms as labelled sections. Takes precedence when present. */
  termsSections?: { heading: string; body: string }[];
  clientSigns: boolean;
  additionalSignerLabels: string[];
  firmCountersigns: boolean;
  depositCents: number | null;
};

/** The client's four steps through the document. */
const STEPS = ["introduction", "services", "terms", "sign"] as const;
type BilledKey =
  | "preview_billed_once"
  | "preview_billed_weekly"
  | "preview_billed_monthly"
  | "preview_billed_quarterly"
  | "preview_billed_yearly";

type StepKey =
  | "preview_step_introduction"
  | "preview_step_services"
  | "preview_step_terms"
  | "preview_step_sign";

export function ProposalPreview({
  data,
  locale,
  /** Which step the reader is looking at, so the builder can follow its tabs. */
  activeStep = "introduction",
  variant = "preview",
}: {
  data: ProposalPreviewData;
  locale: "en" | "fr";
  activeStep?: (typeof STEPS)[number];
  /**
   * WHO IS READING THIS.
   *
   * "preview" — the firm, in a narrow side pane beside the builder. A thumbnail
   *   of the document: terms clamped so one long clause cannot push the rest of
   *   the proposal off screen, and Canopy's own "Get started" chip drawn inert
   *   because the pane is a picture, not a flow.
   *
   * "document" — the CLIENT, on the page where they accept or decline. This is
   *   the contract itself and it has to be readable: nothing clamped, and no
   *   disabled button, because a greyed-out control sitting directly above the
   *   real Accept button is furniture shaped like a way forward.
   *
   * A PROP, not a second component. The whole reason this was pulled out of the
   * builder is that the firm's preview and the client's copy must be the same
   * markup — the moment they are two files, a preview stops meaning anything.
   * CLAUDE.md's rule, and client-team-editor's precedent.
   */
  variant?: "preview" | "document";
}) {
  const isDocument = variant === "document";
  const t = useTranslations("Templates");

  const money = (cents: number) =>
    new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(cents / 100);

  const periodLabel =
    data.periodMonths == null
      ? t("period_ongoing")
      : t("period_months", { count: data.periodMonths });

  const namedServices = data.services.filter((s) => s.name.trim().length > 0);
  // Sections when there are any, otherwise the legacy string upgraded — one
  // reader, so the two shapes cannot render differently.
  const termsSections =
    readTermsSections(data.termsSections).length > 0
      ? readTermsSections(data.termsSections)
      : readTermsSections(data.terms ?? null);
  const showRates = data.priceVisibility?.itemizedPrice !== false;
  // Totalled from the LINES, not from a stored figure — the document computes
  // its own sum the same way the builder did, so the two cannot disagree.
  const totals = computeBillingTotals(
    namedServices.map((x) => ({
      name: x.name,
      serviceId: null,
      description: null,
      rateCents: x.rateCents,
      rateType: "item" as const,
      billingFrequency: x.billingFrequency ?? "once",
      taxPct: x.taxPct ?? null,
    })),
    { depositCents: data.depositCents },
  );
  // ── AN UPLOADED FILE COUNTS AS AN INTRODUCTION ─────────────────────────
  //
  // This asked only about a pasted LINK and a document NAME. A firm that
  // UPLOADED a welcome video therefore had an introduction the client was shown
  // literally nothing of — and if the video was the only thing in it, they got
  // the "no introduction" empty state instead. The founder asked for real file
  // uploads, not just links; the upload worked and the render never learned.
  const videoLabel = data.videoUrl?.trim() || fileLabel(data.videoPath);
  const documentLabel = data.documentName?.trim() || fileLabel(data.documentPath);
  const hasIntro =
    (data.welcome?.trim().length ?? 0) > 0 ||
    videoLabel.length > 0 ||
    documentLabel.length > 0;

  // No max-width of its own. It is ALWAYS inside something that has already
  // decided how wide a proposal should be — the wizard's preview card, or the
  // portal's accept page — and a 448px cap inside a 520px card just painted a
  // stripe of empty wash down both sides.
  return (
    <div className="w-full space-y-4">
      {/* ── THE CLIENT'S PROGRESS ─────────────────────────────────────────
          A GRID of equal columns, with the connectors drawn between the
          circles rather than inside the steps.

          It was a flex row where each step owned the connector after it. That
          made every column a different width — the last step had no connector,
          so it was narrower than the rest and the whole rail sat off-centre
          against the card beneath it. The founder: "the preview is not
          alligned correctly and looks off." Equal columns cannot drift. */}
      <ol
        className="grid items-start"
        style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}
      >
        {STEPS.map((step, i) => {
          const active = step === activeStep;
          return (
            <li key={step} className="flex flex-col items-center gap-1">
              <div className="flex w-full items-center">
                {/* Half-width rules either side of the circle, so the line
                    meets the neighbouring circle exactly and the first and
                    last steps stay flush with the card's edges. */}
                <span
                  aria-hidden
                  className={cn("h-px flex-1", i === 0 ? "bg-transparent" : "bg-border")}
                />
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    active
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "h-px flex-1",
                    i === STEPS.length - 1 ? "bg-transparent" : "bg-border",
                  )}
                />
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-[10px]",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`preview_step_${step}` as StepKey)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div>
          <p className="text-xs text-muted-foreground">
            {t("preview_client_label")}
          </p>
          <p className="text-sm font-semibold">{data.clientName}</p>
        </div>

        <div className="border-t border-border/60 pt-3">
          <p className="text-xs italic text-muted-foreground">
            {t("engagement_name_label")}
          </p>
          <p className="text-sm">
            {data.engagementName || t("preview_untitled")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.periodStartsOn === "acceptance"
              ? t("preview_begins_acceptance", { period: periodLabel })
              : t("preview_begins_custom", { period: periodLabel })}
          </p>
        </div>

        <Section title={t("tab_introduction")}>
          {hasIntro ? (
            <div className="space-y-2 text-left">
              {data.welcome?.trim() && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed">
                  {data.welcome}
                </p>
              )}
              {videoLabel && (
                <IntroFile
                  icon={<PlayCircle className="size-3.5 shrink-0" aria-hidden />}
                  label={videoLabel}
                  // A pasted link is already openable; an uploaded file needs
                  // the portal to have signed a URL for it.
                  href={data.videoUrl?.trim() || data.videoHref || null}
                />
              )}
              {documentLabel && (
                <IntroFile
                  icon={<FileText className="size-3.5 shrink-0" aria-hidden />}
                  label={documentLabel}
                  href={data.documentHref ?? null}
                />
              )}
            </div>
          ) : (
            <Empty
              title={t("preview_no_intro")}
              hint={t("preview_no_intro_hint")}
            />
          )}
        </Section>

        <Section title={t("tab_services")}>
          {/* ── GROUPED BY HOW IT BILLS ──────────────────────────────────
              The founder: "the change to billing structure should update the
              preview proposal."

              Right — the firm authors these in billing blocks, so the client
              should read them the same way: "Billed one time", "Billed
              monthly", each with its own total, rather than one flat list that
              hides which charges recur. Grouped from the SAME
              computeBillingTotals the firm's own readout uses, so the two can
              never disagree about what falls where. */}
          {namedServices.length > 0 ? (
            <div className="space-y-3 text-xs">
              {totals.groups.map((group) => {
                const inGroup = namedServices.filter(
                  (x) => (x.billingFrequency ?? "once") === group.frequency,
                );
                if (inGroup.length === 0) return null;
                return (
                  <div key={group.frequency}>
                    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
                      <span className="font-medium">
                        {t(`preview_billed_${group.frequency}` as BilledKey)}
                      </span>
                      {/* The group's own total, and only when the firm chose
                          to show block totals. */}
                      {data.priceVisibility?.blockTotals !== false && (
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {group.determined
                            ? money(group.totalCents)
                            : t("totals_tbd_short")}
                        </span>
                      )}
                    </div>
                    <ul className="mt-1.5 space-y-1.5">
                      {inGroup.map((item, idx) => (
                        <li key={idx}>
                          <div className="flex justify-between gap-3">
                            <span className="truncate">{item.name}</span>
                            {/* Hidden when the firm chose not to itemize. The
                                line stays — the client still needs to know
                                what they are getting, just not what each part
                                of it costs. */}
                            {showRates && (
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {item.rateCents == null
                                  ? "—"
                                  : money(item.rateCents)}
                              </span>
                            )}
                          </div>
                          {/* What this line actually buys. Indented and muted:
                              it is detail, not another thing to pay for. */}
                          {item.work && item.work.length > 0 && (
                            <ul className="mt-1 space-y-0.5 border-l border-border pl-2.5 text-left">
                              {item.work.map((step, i) => (
                                <li
                                  key={i}
                                  className="text-[11px] leading-relaxed text-muted-foreground"
                                >
                                  {step}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              title={t("preview_no_services")}
              hint={t("preview_no_services_hint")}
            />
          )}

          {/* What it comes to — the same panel the firm reads while building
              it, filtered by what they chose to show. */}
          {totals.groups.length > 0 && (
            <div className="mt-3 border-t border-border pt-3 text-left">
              <BillingTotalsPanel
                totals={totals}
                locale={locale}
                visibility={
                  data.priceVisibility ?? {
                    blockTotals: true,
                    total: true,
                  }
                }
              />
            </div>
          )}
        </Section>

        <Section title={t("tab_terms")}>
          {termsSections.length > 0 ? (
            // Each section under its own heading — what the client actually
            // reads. A legacy single block arrives here as one untitled
            // section, so an already-signed proposal is unchanged.
            <div className="space-y-2 text-left">
              {termsSections.map((section, i) => (
                <div key={i}>
                  {section.heading.trim() && (
                    <p className="text-xs font-medium">{section.heading}</p>
                  )}
                  {/* NEVER clamped for the client. A real scope or liability
                      clause runs well past six lines, and the clamp had no
                      expand control anywhere — so the person being asked to
                      agree could not read what they were agreeing to. */}
                  <p
                    className={cn(
                      "whitespace-pre-wrap leading-relaxed text-muted-foreground",
                      isDocument ? "text-sm" : "line-clamp-6 text-xs",
                    )}
                  >
                    {section.body}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title={t("preview_no_terms")}
              hint={t("preview_no_terms_hint")}
            />
          )}
        </Section>

        <Section title={t("preview_step_sign")}>
          <div className="space-y-1.5 text-left text-xs">
            {/* Every signature line the client will actually see. A template
                names ROLES, not people — the person is chosen when the
                engagement is created. */}
            {data.clientSigns && (
              <SignerLine label={t("preview_signer_client")} />
            )}
            {data.additionalSignerLabels.map((label, idx) => (
              <SignerLine key={idx} label={label} />
            ))}
            {data.firmCountersigns && (
              <SignerLine label={t("preview_signer_firm")} />
            )}
            {!data.clientSigns &&
              data.additionalSignerLabels.length === 0 &&
              !data.firmCountersigns && (
                <Empty
                  title={t("preview_no_signers")}
                  hint={t("preview_no_signers_hint")}
                />
              )}
            {data.depositCents != null && (
              <p className="pt-1 text-muted-foreground">
                {t("preview_deposit", { amount: money(data.depositCents) })}
              </p>
            )}
          </div>
        </Section>

        {/* Canopy's own call to action at the foot of the document — a PICTURE
            of one, which is why it is disabled.

            Never rendered on the client's copy. There it sat greyed out
            directly above the real Accept button: a control that looks like the
            way forward and does nothing, immediately above the one that is. The
            client's page has its own Accept and Decline. */}
        {!isDocument && (
          <button
            type="button"
            disabled
            className="ml-auto flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
          >
            {t("preview_get_started")}
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/** A file's own name, from its storage path. Used when nothing friendlier was
 *  recorded — better than showing the client a bare path, or nothing. */
function fileLabel(path: string | null | undefined): string {
  const raw = (path ?? "").trim();
  if (raw.length === 0) return "";
  return decodeURIComponent(raw.split("/").pop() ?? "").trim();
}

/** One line of the introduction: an icon, a name, and a link when there is
 *  something to open. Plain text otherwise, never a dead anchor. */
function IntroFile({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string | null;
}) {
  const body = (
    <>
      {icon}
      <span className="truncate">{label}</span>
    </>
  );
  if (!href) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {body}
      </p>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {body}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60">
      <p className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-medium">
        {title}
      </p>
      <div className="px-3 py-4">{children}</div>
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SignerLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground">
      <PenLine className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <span aria-hidden className="ml-1 h-px flex-1 bg-border" />
    </p>
  );
}
