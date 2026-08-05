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
  services: { name: string; rateCents: number | null; work?: string[] }[];
  terms: string | null;
  clientSigns: boolean;
  additionalSignerLabels: string[];
  firmCountersigns: boolean;
  depositCents: number | null;
};

/** The client's four steps through the document. */
const STEPS = ["introduction", "services", "terms", "sign"] as const;
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
}: {
  data: ProposalPreviewData;
  locale: "en" | "fr";
  activeStep?: (typeof STEPS)[number];
}) {
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
  const hasIntro =
    (data.welcome?.trim().length ?? 0) > 0 ||
    (data.videoUrl?.trim().length ?? 0) > 0 ||
    (data.documentName?.trim().length ?? 0) > 0;

  return (
    <div className="w-full max-w-md space-y-4">
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
              {data.videoUrl?.trim() && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PlayCircle className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{data.videoUrl}</span>
                </p>
              )}
              {data.documentName?.trim() && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{data.documentName}</span>
                </p>
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
          {namedServices.length > 0 ? (
            <ul className="space-y-1.5 text-xs">
              {namedServices.map((item, idx) => (
                <li key={idx}>
                  <div className="flex justify-between gap-3">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {item.rateCents == null ? "—" : money(item.rateCents)}
                    </span>
                  </div>
                  {/* What this line actually buys. Under the price, indented,
                      in the muted size — it is detail, not another line item,
                      and it must never read as something else to pay for. */}
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
          ) : (
            <Empty
              title={t("preview_no_services")}
              hint={t("preview_no_services_hint")}
            />
          )}
        </Section>

        <Section title={t("tab_terms")}>
          {data.terms?.trim() ? (
            <p className="line-clamp-6 whitespace-pre-wrap text-left text-xs leading-relaxed">
              {data.terms}
            </p>
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

        {/* Canopy's own call to action at the foot of the document. */}
        <button
          type="button"
          disabled
          className="ml-auto flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {t("preview_get_started")}
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
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
