import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { formatDate, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Check } from "lucide-react";

// The engagement's facts, in Canopy's shape.
//
// Founder, with thirteen annotated screenshots of Canopy's engagement view:
// "I want to restructure the entire engagement... look exactly how Canopy does",
// and then "I want to copy their UI and the actual process itself, like, the
// way it's structured."
//
// ── WHY A CARD AT ALL ──────────────────────────────────────────────────────
//
// Vylan's engagement page grew a header rather than designing one: title,
// presence faces, stage stepper, assignee control, four kinds of badge, an
// invoice pill, a comment bubble and a "..." menu, stacked down the page in the
// order each was added. Every item is useful and none of it is grouped, so
// answering "when did this go out, and who still owes a signature" means
// reading the whole thing.
//
// Canopy answers those with three columns that never move: WHO (and what they
// still owe), WHEN, and WHAT WE ARE DOING. That is the restructure — the same
// facts, arranged by the question they answer.
//
// ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
//
// "Accepted" has no value yet. Canopy's engagement is a proposal the client
// ACCEPTS, and Vylan has no acceptance step until the creation wizard's later
// phases land — so the row renders an em dash rather than inventing a date from
// sent_at, which would quietly claim a client agreed to something.
//
// Server component on purpose: every value here is already loaded by the page,
// and making it a client component would ship a formatter and a translation
// bundle to do nothing but print dates.

export type EngagementDetailsSigner = {
  name: string;
  signed: boolean;
};

export async function EngagementDetailsCard({
  locale,
  people,
  signers,
  sentAt,
  startsAt,
  acceptedAt,
  dueDate,
  services,
  statusChip,
  agreementNote,
}: {
  locale: AppLocale;
  /** Avatars/names of the firm people on this job, already resolved. */
  people: React.ReactNode;
  /** Empty when the engagement asks for no signature at all. */
  signers: EngagementDetailsSigner[];
  sentAt: string | null;
  /** null ⇒ "on acceptance", which is Canopy's wording for a job not yet begun. */
  startsAt: string | null;
  /** Always null today — see the note above. */
  acceptedAt: string | null;
  dueDate: string | null;
  /** The priced line names. Falls back to the engagement's type upstream. */
  services: string[];
  /** The stage chip or status pill the page already decided on. */
  statusChip: React.ReactNode;
  /** Canopy's "12 month agreement". Null when the job is a one-off. */
  agreementNote?: string | null;
}) {
  const t = await getTranslations("Engagements");
  const signed = signers.filter((s) => s.signed).length;

  const date = (v: string | null) =>
    v ? formatDate(v, locale, "medium") : "—";

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("details_card_title")}
        </h2>
        <div className="flex items-center gap-3">
          {agreementNote && (
            <span className="text-xs italic text-muted-foreground">
              {agreementNote}
            </span>
          )}
          {statusChip}
        </div>
      </header>

      {/* Three columns on a wide screen, stacked below — and RULED between,
          which is what stops them reading as one paragraph of facts. */}
      <div className="grid gap-5 px-5 py-4 md:grid-cols-3 md:gap-0">
        {/* ── WHO, and what they still owe ─────────────────────────────── */}
        <div className="md:pr-5">
          {people}
          {signers.length > 0 && (
            <div className="mt-3 space-y-2">
              <Badge
                variant="outline"
                className={cn(
                  "border-border/70 bg-background font-normal",
                  signed === signers.length && "text-foreground",
                )}
              >
                {t("details_signatures", {
                  signed: String(signed),
                  total: String(signers.length),
                })}
              </Badge>
              <ul className="space-y-1.5">
                {signers.map((s) => (
                  <li
                    key={s.name}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate text-foreground">{s.name}</span>
                    {s.signed ? (
                      // Canopy puts a tick and the word, in green. It is the
                      // one thing on this card you scan for.
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-stage-completed">
                        <Check className="size-3.5" aria-hidden />
                        {t("details_signed")}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("details_awaiting_signature")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── WHEN ─────────────────────────────────────────────────────── */}
        <dl className="space-y-2 text-sm md:border-l md:border-border/60 md:px-5">
          <div className="text-sm font-medium text-foreground">
            {t("details_dates")}
          </div>
          {[
            { label: t("details_sent"), value: date(sentAt) },
            {
              label: t("details_starts"),
              // "On acceptance" rather than a blank: a job that has not begun
              // has a REASON it has not begun, and that is the reason.
              value: startsAt ? date(startsAt) : t("details_on_acceptance"),
            },
            { label: t("details_accepted"), value: date(acceptedAt) },
            { label: t("details_due"), value: date(dueDate) },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">
                {row.label}
              </dt>
              <dd className="font-medium tabular-nums text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* ── WHAT WE ARE DOING ────────────────────────────────────────── */}
        <div className="text-sm md:border-l md:border-border/60 md:pl-5">
          <div className="text-sm font-medium text-foreground">
            {t("details_services")}
          </div>
          {services.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {services.map((s, i) => (
                <li key={`${s}-${i}`} className="text-foreground">
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted-foreground">
              {t("details_no_services")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
