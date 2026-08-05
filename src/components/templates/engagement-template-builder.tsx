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
// They are right, and it matches Canopy: Create Engagement and Create
// Engagement Template are two screens. They ask different questions (a template
// has no client and no due date; it has a name, an access level and a period
// RULE rather than a date), and they are laid out differently — Canopy's
// template builder is tabs-plus-preview, the engagement builder is a step rail.
//
// ── WHAT "NOT A DUPLICATE" MEANS HERE ──────────────────────────────────────
//
// The founder ALSO said "you wouldnt be building a duplicate builder". Both
// things are true: two screens, but not two copies of the parts. Everything
// that is genuinely the same object is imported, never re-implemented —
// EngagementItemsEditor for the priced scope, the placeholder resolver for
// {{clientname}}, the same save action, the same payload reader. What lives
// here is only what is actually different: this screen's chrome, its fields and
// its preview.
//
// If a THIRD surface ever needs priced lines, it imports the same editor. That
// is the cohesion rule working, not being broken.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import {
  EngagementItemsEditor,
  type CatalogueService,
} from "@/components/engagements/engagement-items-editor";
import type { EngagementItemDraft } from "@/lib/engagements/items";
import {
  resolvePlaceholders,
  PLACEHOLDERS,
  placeholderText,
} from "@/lib/engagements/placeholders";
import { saveEngagementAsTemplateAction } from "@/app/actions/engagement-templates";

// Canopy's four tabs are Introduction · Services · Terms · Signatures.
// Terms and Signatures are PARKED by founder decision — they arrive with the
// proposal document, which is deliberately last because it is generated from
// everything else. They are left OUT rather than shown disabled: a tab you can
// click that says "not built yet" is worse than a tab that isn't there.
const TABS = ["introduction", "services"] as const;
type Tab = (typeof TABS)[number];

// Spelled out so a typo is a compile error rather than a `Templates.tab_x`
// rendering on screen — next-intl fails silently and this repo has been bitten
// by it twice.
type TabKey = "tab_introduction" | "tab_services";

// Canopy's period dropdown. Null is their "Ongoing", which is the honest
// default for bookkeeping — the work does not stop on a date.
const PERIOD_OPTIONS: (number | null)[] = [null, 1, 3, 6, 12, 24];

export function EngagementTemplateBuilder({
  locale,
  services = [],
  fallbackTaxPct = null,
}: {
  locale: "en" | "fr";
  services?: CatalogueService[];
  fallbackTaxPct?: number | null;
}) {
  const t = useTranslations("Templates");
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("introduction");
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"team" | "private">("team");
  const [title, setTitle] = useState("");
  const [periodStartsOn, setPeriodStartsOn] = useState<"acceptance" | "custom">(
    "acceptance",
  );
  const [periodMonths, setPeriodMonths] = useState<number | null>(null);
  const [introMessage, setIntroMessage] = useState("");
  const [items, setItems] = useState<EngagementItemDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A template needs a name of its own AND a name for the engagements it makes.
  // Canopy marks both required, and it is right: without the second, every
  // engagement from this template would be called nothing.
  const canSave = name.trim().length > 0 && title.trim().length > 0;
  // Which tab is missing something — Canopy puts a red mark on the tab itself
  // so you can see the problem without opening it.
  const introIncomplete = name.trim().length === 0 || title.trim().length === 0;

  // What the client would see. Placeholders resolve against a SAMPLE client,
  // because a template has none — showing the raw {{clientname}} in a preview
  // meant to answer "what does this look like" would answer the wrong question.
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

  function save() {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const res = await saveEngagementAsTemplateAction({
        name: name.trim(),
        access,
        payload: {
          title: title.trim(),
          periodStartsOn,
          periodMonths,
          introMessage: introMessage.trim(),
          items: items.filter((i) => i.name.trim().length > 0),
        },
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
    months == null
      ? t("period_ongoing")
      : t("period_months", { count: months });

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
            disabled={!canSave || pending}
            onClick={save}
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

      {/* ── TABS ──────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label={t("create_engagement_template")}
        className="flex items-center gap-1 border-b border-border px-5"
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
                  Said in TEXT too, not colour alone — a red dot is invisible to
                  anyone who cannot see red. */}
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

      {/* ── FORM (left) + PREVIEW (right) ─────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <div className="min-h-0 space-y-5 overflow-y-auto border-border p-5 lg:border-r">
          {tab === "introduction" && (
            <>
              <section className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t("template_details")}
                </h2>
                <div className="space-y-1.5">
                  <label
                    htmlFor="tpl-name"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("template_name_label")} *
                  </label>
                  <Input
                    id="tpl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("task_templates_name_placeholder")}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["team", "private"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors",
                        access === value
                          ? "border-accent bg-accent/5"
                          : "border-border hover:border-border/80",
                      )}
                    >
                      <input
                        type="radio"
                        name="tpl-access"
                        className="mt-0.5"
                        checked={access === value}
                        onChange={() => setAccess(value)}
                      />
                      <span>
                        <span className="block text-xs text-muted-foreground">
                          {t("template_access")}
                        </span>
                        <span className="block text-sm font-medium">
                          {value === "team"
                            ? t("access_team")
                            : t("access_private")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-3 border-t border-border/60 pt-4">
                <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t("engagement_details")}
                </h2>
                <div className="space-y-1.5">
                  <label
                    htmlFor="tpl-title"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("engagement_name_label")} *
                  </label>
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
                        {tEng(`placeholder_${token}` as "placeholder_clientname")}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["acceptance", "custom"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors",
                        periodStartsOn === value
                          ? "border-accent bg-accent/5"
                          : "border-border hover:border-border/80",
                      )}
                    >
                      <input
                        type="radio"
                        name="tpl-period-start"
                        className="mt-0.5"
                        checked={periodStartsOn === value}
                        onChange={() => setPeriodStartsOn(value)}
                      />
                      <span>
                        <span className="block text-xs text-muted-foreground">
                          {t("period_begins_on")}
                        </span>
                        <span className="block text-sm font-medium">
                          {value === "acceptance"
                            ? t("period_acceptance")
                            : t("period_custom_date")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {/* No date picker for "custom". A template reused next season
                    must not carry last season's start — the rule is stored, and
                    the date is asked for when the engagement is created. */}
                {periodStartsOn === "custom" && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("period_custom_hint")}
                  </p>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="tpl-period"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("period_label")}
                  </label>
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
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="tpl-intro"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("welcome_message")}
                  </label>
                  <Textarea
                    id="tpl-intro"
                    value={introMessage}
                    onChange={(e) => setIntroMessage(e.target.value)}
                    placeholder={tEng("intro_message_placeholder")}
                    rows={4}
                  />
                </div>
              </section>
            </>
          )}

          {tab === "services" && (
            // IMPORTED, not rebuilt. This is the same priced-scope editor the
            // engagement builder uses — same rounding, same catalogue picker,
            // same totals. A second copy is how the two would start disagreeing
            // about money.
            <EngagementItemsEditor
              items={items}
              onChange={setItems}
              locale={locale}
              services={services}
              fallbackTaxPct={fallbackTaxPct}
            />
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

        {/* ── THE PREVIEW ─────────────────────────────────────────────── */}
        <div className="hidden min-h-0 overflow-y-auto bg-muted/30 p-5 lg:block">
          <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-5">
            <div>
              <p className="text-xs text-muted-foreground">
                {t("preview_client_label")}
              </p>
              <p className="text-sm font-semibold">
                {t("preview_sample_client")}
              </p>
            </div>
            <div className="border-t border-border/60 pt-3">
              <p className="text-xs italic text-muted-foreground">
                {t("engagement_name_label")}
              </p>
              <p className="text-sm">
                {previewTitle || t("preview_untitled")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {periodStartsOn === "acceptance"
                  ? t("preview_begins_acceptance", {
                      period: periodLabel(periodMonths),
                    })
                  : t("preview_begins_custom", {
                      period: periodLabel(periodMonths),
                    })}
              </p>
            </div>

            <div className="rounded-lg border border-border/60">
              <p className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-medium">
                {t("tab_introduction")}
              </p>
              <div className="px-3 py-4 text-center">
                {introMessage.trim() ? (
                  <p className="whitespace-pre-wrap text-left text-xs leading-relaxed">
                    {introMessage}
                  </p>
                ) : (
                  <>
                    <p className="text-xs font-medium">
                      {t("preview_no_intro")}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("preview_no_intro_hint")}
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border/60">
              <p className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-medium">
                {t("tab_services")}
              </p>
              <div className="px-3 py-4">
                {items.filter((i) => i.name.trim()).length > 0 ? (
                  <ul className="space-y-1.5 text-xs">
                    {items
                      .filter((i) => i.name.trim())
                      .map((item, idx) => (
                        <li key={idx} className="flex justify-between gap-3">
                          <span className="truncate">{item.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {item.rateCents == null
                              ? "—"
                              : new Intl.NumberFormat(
                                  locale === "fr" ? "fr-CA" : "en-CA",
                                  { style: "currency", currency: "CAD" },
                                ).format(item.rateCents / 100)}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <div className="text-center">
                    <p className="text-xs font-medium">
                      {t("preview_no_services")}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("preview_no_services_hint")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
