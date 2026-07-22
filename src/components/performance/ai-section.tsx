"use client";

import { cn } from "@/lib/cn";
import { formatNumber, type AppLocale } from "@/lib/format";
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
  locale,
  copy,
}: {
  data: AiData;
  locale: AppLocale;
  copy: PerfCopy["ai"];
}) {
  const empty = data.assessedCount === 0;
  const percent = String(Math.round((data.agreementRate ?? 0) * 100));

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card sm:p-6">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
    </section>
  );
}

const TONE_STYLES: Record<
  Tone,
  { box: string; count: string; dot: string; tag: string }
> = {
  // Tag text is muted (reads on both themes at all sizes); the case's colour is
  // carried by the dot + count/box. Exception: the false-pass ("miss") keeps its
  // red tag — it's the one to notice, and destructive passes AA on the card.
  agreement: {
    box: "border-border",
    count: "text-foreground",
    dot: "bg-success",
    tag: "text-muted-foreground",
  },
  miss: {
    box: "border-destructive/40 bg-destructive/[0.06]",
    count: "text-destructive",
    dot: "bg-destructive",
    tag: "text-destructive",
  },
  alarm: {
    box: "border-warning/40",
    count: "text-foreground",
    dot: "bg-warning",
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
    <div className={cn("rounded-lg border p-3", s.box)}>
      <div className="flex items-center justify-between">
        <CountUp
          value={count}
          format={(n) => formatNumber(Math.round(n), locale)}
          className={cn("num-display text-2xl font-semibold tabular-nums", s.count)}
        />
        <span className={cn("size-2 shrink-0 rounded-full", s.dot)} aria-hidden />
      </div>
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
