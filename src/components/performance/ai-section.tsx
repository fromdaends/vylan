"use client";

import { cn } from "@/lib/cn";
import { formatDate, formatNumber, type AppLocale } from "@/lib/format";
import type { AiUsage } from "@/lib/ai/usage";
import type { AiSection as AiData, FourCase } from "@/lib/performance/types";
import type { PerfCopy } from "./copy";
import { AiRing } from "./ai-ring";
import { CountUp } from "./count-up";

type Tone = "agreement" | "miss" | "alarm";

const CASE_ORDER: { key: FourCase; tone: Tone }[] = [
  { key: "true_pass", tone: "agreement" },
  { key: "true_catch", tone: "agreement" },
  { key: "false_pass", tone: "miss" }, // the miss that matters — highlighted
  { key: "false_alarm", tone: "alarm" },
];

export function AiSection({
  data,
  usage,
  locale,
  copy,
}: {
  data: AiData;
  // Monthly AI-check usage meter (Settings > Documents parity). Null when the
  // firm couldn't be resolved — the rest of the section still renders.
  usage: AiUsage | null;
  locale: AppLocale;
  copy: PerfCopy["ai"];
}) {
  const empty = data.assessedCount === 0;
  const percent = String(Math.round((data.agreementRate ?? 0) * 100));

  return (
    <section className="mt-10 border-t border-border/60 pt-10 sm:mt-12 sm:pt-12">
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {copy.heading}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{copy.caption}</p>
      </header>

      {empty ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
          {copy.empty}
        </div>
      ) : (
        <div className="grid items-center gap-8 lg:grid-cols-[auto_1fr] lg:gap-12">
          {/* Ring + plain-English read */}
          <div className="flex flex-col items-center text-center">
            <AiRing
              rate={data.agreementRate}
              muted={data.earlyData}
              label={copy.agreementWord}
              locale={locale}
            />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {data.earlyData
                ? copy.earlyData(data.assessedCount)
                : copy.agreement(percent, data.assessedCount)}
            </p>
          </div>

          {/* Four cases + volume + methodology */}
          <div className="min-w-0">
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              {CASE_ORDER.map(({ key, tone }) => (
                <CaseCell
                  key={key}
                  tone={tone}
                  count={data.cases[key]}
                  locale={locale}
                  label={copy.cases[key]}
                  tag={
                    tone === "miss"
                      ? copy.tagMissed
                      : tone === "alarm"
                        ? copy.tagFalseAlarm
                        : copy.tagAgreement
                  }
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">{copy.assessed(data.assessedCount)}</span>
              {data.skippedAiOffCount > 0 && (
                <span className="tabular-nums">
                  {copy.skipped(data.skippedAiOffCount)}
                </span>
              )}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
              {copy.methodology}
            </p>
          </div>
        </div>
      )}

      {usage && <UsageMeter usage={usage} locale={locale} copy={copy} />}
    </section>
  );
}

// The Settings > Documents AI-check meter, mirrored here: {used} of {cap} used
// this month + how many are left. This is a MONTHLY plan counter (not
// range-scoped like the agreement stats above), so it carries its own heading.
function UsageMeter({
  usage,
  locale,
  copy,
}: {
  usage: AiUsage;
  locale: AppLocale;
  copy: PerfCopy["ai"];
}) {
  const used = formatNumber(usage.used, locale);
  const cap = formatNumber(usage.cap, locale);
  const remaining = formatNumber(Math.max(0, usage.cap - usage.used), locale);
  const pct = Math.min(
    100,
    Math.round((usage.used / Math.max(1, usage.cap)) * 100),
  );
  const showResets = !usage.isTrial && usage.resetsAt !== "";

  return (
    <div className="mt-8 max-w-md border-t border-border/60 pt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {copy.usageHeading}
        </span>
        {usage.paused && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
            {copy.usagePaused}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">{copy.usageLabel}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {usage.isTrial
            ? copy.usageCountTrial(used, cap)
            : copy.usageCount(used, cap)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            usage.paused ? "bg-warning" : "bg-icon-blue",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span>{copy.usageRemaining(remaining)}</span>
        {showResets && (
          <span>{copy.usageResets(formatDate(usage.resetsAt, locale, "medium"))}</span>
        )}
      </div>
    </div>
  );
}

// A left accent bar carries each case's colour (no box) so the four cases mesh
// with the page instead of floating as cards. Tag text stays muted for
// contrast; the false-pass ("miss") keeps its red count + tag — it's the one to
// notice, and destructive passes AA.
const TONE_STYLES: Record<Tone, { accent: string; count: string; tag: string }> =
  {
    agreement: {
      accent: "border-success/60",
      count: "text-foreground",
      tag: "text-muted-foreground",
    },
    miss: {
      accent: "border-destructive",
      count: "text-destructive",
      tag: "text-destructive",
    },
    alarm: {
      accent: "border-warning/70",
      count: "text-foreground",
      tag: "text-muted-foreground",
    },
  };

function CaseCell({
  tone,
  count,
  locale,
  label,
  tag,
}: {
  tone: Tone;
  count: number;
  locale: AppLocale;
  label: string;
  tag: string;
}) {
  const s = TONE_STYLES[tone];
  return (
    <div className={cn("border-l-2 pl-3.5", s.accent)}>
      <CountUp
        value={count}
        format={(n) => formatNumber(Math.round(n), locale)}
        className={cn(
          "num-display block text-2xl font-semibold tabular-nums",
          s.count,
        )}
      />
      <div className="mt-1 text-xs text-foreground/90">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[10px] font-medium uppercase tracking-wide",
          s.tag,
        )}
      >
        {tag}
      </div>
    </div>
  );
}
