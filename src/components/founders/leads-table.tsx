"use client";

// THE PIPELINE — every prospect who touched the public /demo form.
//
// Until now this data existed only as an email: lib/demo-notify.ts sends the
// founder one message per lead and the row is never seen again. That is fine
// for "somebody just signed up" and useless for "how is the funnel doing", so
// the same rows are a table here.
//
// The funnel line at the top is the whole point of the qualifying form: step 1
// is a name and an email, step 2 is the qualifying answers, step 3 is contact
// details, and a booking is the only one of the four that means anything is
// actually happening.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarCheck, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { matchesQuery, relativeAge } from "@/lib/founders/aggregate";
import type { LeadRow } from "@/lib/founders/types";

/** Human labels for the qualifying answers. Deliberately NOT translated: they
 *  mirror the option values in demo-notify.ts, which are English-only because
 *  they were written for the founder's inbox rather than for a customer. Two
 *  spellings of the same enum is how a filter starts missing rows. */
const FIRM_SIZE: Record<string, string> = {
  solo: "Solo",
  "2_5": "2–5",
  "6_15": "6–15",
  "16_plus": "16+",
};
const VOLUME: Record<string, string> = {
  under_25: "<25 clients",
  "25_100": "25–100",
  "100_300": "100–300",
  "300_plus": "300+",
};
const TOOL: Record<string, string> = {
  manual_email: "Email & manual",
  taxdome: "TaxDome",
  karbon: "Karbon",
  other_software: "Other software",
  nothing: "Nothing structured",
};

function label(map: Record<string, string>, value: string | null): string {
  if (!value) return "—";
  // An unmapped value falls through to the raw string on purpose: the "other"
  // choices store the prospect's own free text, which is exactly what we want
  // to read.
  return map[value] ?? value;
}

export function LeadsTable({ leads, nowMs }: { leads: LeadRow[]; nowMs: number }) {
  const t = useTranslations("Founders");
  const [query, setQuery] = useState("");
  const [onlyQualified, setOnlyQualified] = useState(false);

  const funnel = useMemo(
    () => ({
      total: leads.length,
      step2: leads.filter((l) => l.furthestStep >= 2).length,
      step3: leads.filter((l) => l.furthestStep >= 3).length,
      booked: leads.filter((l) => l.bookedAt).length,
      converted: leads.filter((l) => l.converted).length,
      optIn: leads.filter((l) => l.marketingOptIn).length,
    }),
    [leads],
  );

  const visible = useMemo(() => {
    const base = onlyQualified ? leads.filter((l) => l.furthestStep >= 3) : leads;
    if (!query.trim()) return base;
    return base.filter((l) =>
      matchesQuery(
        [l.contactName ?? "", l.email, l.firmName ?? "", l.province ?? ""].join(" "),
        query,
      ),
    );
  }, [leads, query, onlyQualified]);

  return (
    <div>
      <ul className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { key: "total", value: funnel.total, label: t("funnel_started") },
          { key: "step2", value: funnel.step2, label: t("funnel_qualified") },
          { key: "step3", value: funnel.step3, label: t("funnel_contact") },
          { key: "booked", value: funnel.booked, label: t("funnel_booked") },
          { key: "converted", value: funnel.converted, label: t("funnel_converted") },
          { key: "optin", value: funnel.optIn, label: t("funnel_opt_in") },
        ].map((s) => (
          <li key={s.key} className="min-w-0 border-l border-border/40 pl-3">
            <p className="text-xl font-semibold leading-none tabular-nums">{s.value}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{s.label}</p>
          </li>
        ))}
      </ul>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 border-b border-border/60 py-1">
          <Search className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("leads_search_placeholder")}
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyQualified}
            onChange={(e) => setOnlyQualified(e.target.checked)}
            className="size-3.5 accent-[var(--accent)]"
          />
          {t("leads_only_qualified")}
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">{t("col_lead")}</th>
              <th scope="col" className="py-2 pl-3 font-medium">{t("col_firm_size")}</th>
              <th scope="col" className="py-2 pl-3 font-medium">{t("col_volume")}</th>
              <th scope="col" className="py-2 pl-3 font-medium">{t("col_tool")}</th>
              <th scope="col" className="py-2 pl-3 font-medium">{t("col_province")}</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">{t("col_step")}</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">{t("col_when")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {leads.length === 0 ? t("leads_empty") : t("leads_no_matches")}
                </td>
              </tr>
            ) : (
              visible.map((l) => (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/40">
                  <td className="py-2 pr-3">
                    <p className="flex items-center gap-1.5 font-medium">
                      {l.contactName?.trim() || l.email}
                      {l.bookedAt && (
                        <CalendarCheck
                          className="size-3.5 text-emerald-500"
                          aria-label={t("funnel_booked")}
                        />
                      )}
                      {l.converted && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          {t("tag_converted")}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.firmName?.trim() ? `${l.firmName} · ` : ""}
                      <a href={`mailto:${l.email}`} className="hover:text-foreground hover:underline">
                        {l.email}
                      </a>
                      {l.preferredLanguage ? ` · ${l.preferredLanguage.toUpperCase()}` : ""}
                    </p>
                  </td>
                  <td className="py-2 pl-3">{label(FIRM_SIZE, l.firmSize)}</td>
                  <td className="py-2 pl-3">{label(VOLUME, l.clientVolume)}</td>
                  <td className="py-2 pl-3">{label(TOOL, l.currentTool)}</td>
                  <td className="py-2 pl-3">{l.province ?? "—"}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    <span
                      className={cn(
                        "rounded px-1.5 py-px text-xs",
                        l.furthestStep >= 3
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {l.furthestStep}/3
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                    <span title={l.createdAt}>{relativeAge(l.createdAt, nowMs)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
