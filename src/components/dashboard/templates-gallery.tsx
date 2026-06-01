"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, FilePlus2, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export type TemplateCard = {
  id: string;
  name: string;
  type: "t1" | "t2" | "bookkeeping" | "custom";
  itemCount: number;
  builtIn: boolean;
};

const CATEGORIES = ["recommended", "t1", "t2", "bookkeeping"] as const;
type Category = (typeof CATEGORIES)[number];

// The templates gallery — a Word-style row of "start here" cards. The
// category pills and search both narrow the same horizontal card row.
// "Recommended" surfaces every usable template (built-in starters + the
// firm's own); the other tabs filter by engagement type. Each card opens the
// new-engagement flow pre-loaded with that template; a leading "blank" card
// starts from scratch.
export function TemplatesGallery({ templates }: { templates: TemplateCard[] }) {
  const t = useTranslations("Dashboard");
  const [category, setCategory] = useState<Category>("recommended");
  const [query, setQuery] = useState("");

  // T1 / T2 are tax-form names — identical in both languages — so they
  // stay literal; the rest are translated.
  const label = (c: Category): string => {
    switch (c) {
      case "t1":
        return "T1";
      case "t2":
        return "T2";
      case "bookkeeping":
        return t("tmpl_cat_bookkeeping");
      default:
        return t("tmpl_cat_recommended");
    }
  };

  const q = query.trim().toLowerCase();
  // Recommended = all templates (built-in + the firm's own); the type tabs
  // narrow by engagement type.
  const inCategory = (tmpl: TemplateCard) =>
    category === "recommended" ? true : tmpl.type === category;
  const visible = templates.filter(
    (tmpl) =>
      inCategory(tmpl) && (q === "" || tmpl.name.toLowerCase().includes(q)),
  );
  // The blank starter only belongs in the unfiltered Recommended view —
  // once you're searching or browsing a type, you want a real checklist.
  const showBlank = category === "recommended" && q === "";

  return (
    <section aria-label={t("tmpl_heading")} className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("tmpl_heading")}
        </h2>
        <Link
          href="/templates"
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          {t("tmpl_view_all")}
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label={t("tmpl_tablist_label")}
          className="inline-flex items-center gap-5 self-start overflow-x-auto"
        >
          {CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(c)}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 pb-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {label(c)}
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tmpl_search_placeholder")}
            aria-label={t("tmpl_search_placeholder")}
            className="h-9 pl-9"
          />
        </div>
      </div>

      {visible.length === 0 && !showBlank ? (
        <div className="rounded-xl border border-dashed border-border/50 px-5 py-10 text-center text-sm text-muted-foreground">
          {t("tmpl_empty")}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {showBlank ? (
            <Link
              href="/engagements/new"
              className="group flex w-44 shrink-0 flex-col gap-3 rounded-xl border border-dashed border-border/60 bg-card/40 p-4 transition-colors hover:border-foreground/20 hover:bg-card sm:w-48"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <FilePlus2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {t("tmpl_blank_name")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("tmpl_blank_hint")}
                </div>
              </div>
            </Link>
          ) : null}

          {visible.map((tmpl) => (
            <Link
              key={tmpl.id}
              href={`/engagements/new?template=${tmpl.id}`}
              className="group flex w-44 shrink-0 flex-col gap-3 rounded-xl border border-border/60 bg-card/40 p-4 transition-colors hover:border-foreground/20 hover:bg-card sm:w-48"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {tmpl.name}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {/* Tax-form templates show their type; firm (custom) ones
                      are just named checklists, so no type tag. */}
                  {tmpl.type !== "custom" && (
                    <>
                      <span>{label(tmpl.type)}</span>
                      <span className="mx-1.5 text-border">·</span>
                    </>
                  )}
                  {t("tmpl_items", { count: tmpl.itemCount })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
