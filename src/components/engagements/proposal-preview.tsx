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
import { formatDate } from "@/lib/format";
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
   * Letterhead. What turns an app screen into a document with a sender.
   *
   * All optional and all degrade: no logo falls back to the firm's name set in
   * the same slot, no brand colour falls back to the app's own accent, and no
   * date simply omits the line rather than inventing "today" onto a contract.
   */
  firmName?: string | null;
  firmLogoUrl?: string | null;
  brandColor?: string | null;
  /** ISO date the proposal went out. */
  sentDate?: string | null;
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
  const accent = data.brandColor?.trim() || "var(--color-accent, #2563eb)";
  // ⚠️ formatDate, NOT a hand-rolled Intl call.
  //
  // `new Date("2026-08-06")` parses as UTC MIDNIGHT, so formatting it anywhere
  // west of UTC renders the day before — my first version dated an August 6
  // proposal "August 5, 2026". A contract dated a day early is not a cosmetic
  // bug. lib/format's parseDateInput exists for exactly this naive-date shape.
  const sent = data.sentDate ? formatDate(data.sentDate, locale) : null;

  // Section numbers are computed, not hardcoded: an engagement with no
  // introduction must not jump from 1 to 3 on a numbered contract.
  const order: string[] = [];
  if (hasIntro) order.push("intro");
  order.push("services", "terms", "sign");
  const num = (key: string) => order.indexOf(key) + 1;

  return (
    <div className="w-full">
      {/* The four-step rail is the BUILDER's orientation aid — it tells the
          firm which part of the client's document their current tab feeds.
          On the client's own copy every section is stacked and visible, none
          of them clickable, and it announces "step 4 of 4" the moment the page
          loads. A progress bar over a contract is app furniture. */}
      {!isDocument && (
        <ol
          className="mb-4 grid items-start"
          style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}
        >
          {STEPS.map((step, i) => {
            const active = step === activeStep;
            return (
              <li key={step} className="flex flex-col items-center gap-1">
                <div className="flex w-full items-center">
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
      )}

      {/* ── THE DOCUMENT ────────────────────────────────────────────────────
          One sheet, not a stack of cards. Every section below is a bare block
          separated by a ruled heading — which is what makes a page read as a
          contract rather than a dashboard. The founder: "This should look
          official, bro." */}
      <div
        className={cn(
          "text-left",
          isDocument ? "text-[15px] leading-relaxed" : "text-xs",
        )}
      >
        {/* Letterhead */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          {data.firmLogoUrl ? (
            <img
              src={data.firmLogoUrl}
              alt={data.firmName ?? ""}
              className={cn("object-contain", isDocument ? "h-10 max-w-[170px]" : "h-6 max-w-[110px]")}
            />
          ) : (
            <span
              className={cn(
                "font-semibold tracking-tight",
                isDocument ? "text-[17px]" : "text-[11px]",
              )}
            >
              {data.firmName ?? ""}
            </span>
          )}
          {sent && (
            <div className={cn("sm:text-right", isDocument ? "" : "text-[10px]")}>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {t("doc_date_label")}
              </p>
              <p className={cn("font-medium", isDocument ? "text-[15px]" : "text-[11px]")}>
                {sent}
              </p>
            </div>
          )}
        </div>

        {/* The firm's own colour, as a rule. One line, and it does more for
            "this came from somewhere" than any amount of chrome. */}
        <div
          aria-hidden
          className={cn("w-full", isDocument ? "mt-6 h-[3px]" : "mt-3 h-[2px]")}
          style={{ background: accent }}
        />

        {/* Title block */}
        <p
          className={cn(
            "uppercase text-muted-foreground",
            isDocument
              ? "mt-8 text-[11px] tracking-[0.22em]"
              : "mt-4 text-[9px] tracking-[0.18em]",
          )}
        >
          {t("doc_kicker")}
        </p>
        <h1
          className={cn(
            "font-semibold leading-[1.15] tracking-tight",
            isDocument ? "mt-1.5 text-[26px] sm:text-[32px]" : "mt-1 text-[15px]",
          )}
        >
          {data.engagementName || t("preview_untitled")}
        </h1>

        {/* Who it is for, and for how long */}
        <div
          className={cn(
            "grid gap-x-8 gap-y-5 border-t border-foreground/15",
            isDocument ? "mt-8 pt-6 sm:grid-cols-2" : "mt-4 pt-3 grid-cols-2",
          )}
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("doc_prepared_for")}
            </p>
            <p className={cn("font-medium", isDocument ? "mt-1 text-[15px]" : "text-[11px]")}>
              {data.clientName}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("doc_period_label")}
            </p>
            <p className={cn("font-medium", isDocument ? "mt-1 text-[15px]" : "text-[11px]")}>
              {data.periodStartsOn === "acceptance"
                ? t("preview_begins_acceptance", { period: periodLabel })
                : t("preview_begins_custom", { period: periodLabel })}
            </p>
          </div>
        </div>

        {hasIntro && (
          <Section n={num("intro")} title={t("tab_introduction")} isDocument={isDocument}>
            {data.welcome?.trim() && (
              <p className="whitespace-pre-wrap leading-relaxed">{data.welcome}</p>
            )}
            {videoLabel && (
              <IntroFile
                icon={<PlayCircle className="size-4 shrink-0" aria-hidden />}
                label={videoLabel}
                href={data.videoUrl?.trim() || data.videoHref || null}
              />
            )}
            {documentLabel && (
              <IntroFile
                icon={<FileText className="size-4 shrink-0" aria-hidden />}
                label={documentLabel}
                href={data.documentHref ?? null}
              />
            )}
          </Section>
        )}

        <Section n={num("services")} title={t("doc_services_heading")} isDocument={isDocument}>
          {namedServices.length > 0 ? (
            <>
              {/* ── A TABLE, BECAUSE A PRICE LIST IS TABULAR ────────────────
                  Rows with a ruled header and right-aligned, tabular amounts.
                  The previous flex list could not align an amount column, and
                  a contract whose figures do not line up reads as a draft. */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-foreground/30 text-left">
                      <th className="pb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t("doc_col_service")}
                      </th>
                      {showRates && (
                        <th className="pb-2.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {t("doc_col_amount")}
                        </th>
                      )}
                    </tr>
                  </thead>
                  {totals.groups.map((group) => {
                    const inGroup = namedServices.filter(
                      (x) => (x.billingFrequency ?? "once") === group.frequency,
                    );
                    if (inGroup.length === 0) return null;
                    return (
                      <tbody key={group.frequency}>
                        <tr>
                          <td
                            colSpan={showRates ? 2 : 1}
                            className="pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                          >
                            {t(`preview_billed_${group.frequency}` as BilledKey)}
                          </td>
                        </tr>
                        {inGroup.map((item, idx) => (
                          <tr key={idx} className="border-b border-foreground/10">
                            {/* NEVER truncated. Truncating a service name on a
                                contract is a correctness bug, not a layout
                                choice — the client agrees to what it says. */}
                            <td className="py-4 pr-8 align-top">
                              <div className="font-medium break-words">{item.name}</div>
                              {item.work && item.work.length > 0 && (
                                <ul className="mt-2 list-outside list-disc pl-4 text-[13.5px] leading-relaxed text-muted-foreground">
                                  {item.work.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            {showRates && (
                              <td className="whitespace-nowrap py-4 text-right align-top tabular-nums">
                                {item.rateCents == null ? (
                                  <span className="text-[13px] italic text-muted-foreground">
                                    {t("totals_determined_later")}
                                  </span>
                                ) : (
                                  money(item.rateCents)
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>

              {/* The totals panel owns every total. The group header used to
                  print its own as well, so each frequency's figure appeared
                  twice on the same page. */}
              {totals.groups.length > 0 && (
                <div className="mt-6 border-t border-foreground/20 pt-4">
                  <BillingTotalsPanel
                    totals={totals}
                    locale={locale}
                    visibility={
                      data.priceVisibility ?? { blockTotals: true, total: true }
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <Empty
              title={t("preview_no_services")}
              hint={t("preview_no_services_hint")}
            />
          )}
        </Section>

        <Section n={num("terms")} title={t("doc_terms_heading")} isDocument={isDocument}>
          {termsSections.length > 0 ? (
            <div className="space-y-1">
              {termsSections.map((section, i) => (
                <div key={i}>
                  {/* NUMBERED clauses — 3.1, 3.2. More than any other single
                      change, this is what makes a block of text read as terms
                      rather than as a paragraph somebody typed. */}
                  {section.heading.trim() && (
                    <h3
                      className={cn(
                        "font-semibold",
                        isDocument ? "mt-7 text-[15px]" : "mt-4 text-[11px]",
                      )}
                    >
                      {num("terms")}.{i + 1} {section.heading}
                    </h3>
                  )}
                  <p
                    className={cn(
                      "whitespace-pre-wrap leading-relaxed text-muted-foreground",
                      section.heading.trim() ? "mt-1.5" : "mt-4",
                      // NEVER clamped for the client: they cannot agree to
                      // what they cannot read.
                      isDocument ? "" : "line-clamp-6",
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

        <Section n={num("sign")} title={t("doc_acceptance_heading")} isDocument={isDocument}>
          {/* ── WHAT ACCEPTING MEANS, IN WORDS ──────────────────────────────
              The signature lines were decorative and the page never said what
              clicking Accept committed anyone to. This sentence IS the
              acceptance instrument — the same shape Ignition uses, where
              accepting plus paying is the binding act rather than a separate
              signing ceremony. */}
          <p className="leading-relaxed">
            {t("doc_acceptance_body", { client: data.clientName })}
          </p>

          {data.depositCents != null && (
            <p className="mt-3 font-medium">
              {t("preview_deposit", { amount: money(data.depositCents) })}
            </p>
          )}

          <div
            className={cn(
              "grid gap-8 border-t border-foreground/15",
              isDocument ? "mt-8 pt-6 sm:grid-cols-2" : "mt-4 pt-4 grid-cols-2",
            )}
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {t("doc_accepted_by")}
              </p>
              <p className={cn("font-medium", isDocument ? "mt-2 text-[15px]" : "text-[11px]")}>
                {data.clientName}
              </p>
              <div className="mt-2 border-t border-foreground/25" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {t("doc_prepared_by")}
              </p>
              <p className={cn("font-medium", isDocument ? "mt-2 text-[15px]" : "text-[11px]")}>
                {data.firmName ?? ""}
              </p>
              <div className="mt-2 border-t border-foreground/25" />
            </div>
          </div>
        </Section>
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

function Section({
  n,
  title,
  isDocument,
  children,
}: {
  n: number;
  title: string;
  isDocument: boolean;
  children: React.ReactNode;
}) {
  // A ruled heading, not a boxed card. Cards stack into the "boxes upon boxes"
  // the founder objected to elsewhere; a numbered rule is what a contract uses.
  return (
    <section className={isDocument ? "mt-11" : "mt-6"}>
      <h2
        className={cn(
          "border-b border-foreground/20 font-semibold uppercase",
          isDocument
            ? "pb-2.5 text-[13px] tracking-[0.14em]"
            : "pb-1.5 text-[10px] tracking-[0.12em]",
        )}
      >
        {n}. {title}
      </h2>
      <div className={isDocument ? "mt-5" : "mt-3"}>{children}</div>
    </section>
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
