"use client";

import { createElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Briefcase,
  Building2,
  Calculator,
  ClipboardList,
  Home,
  Landmark,
  Receipt,
  ScrollText,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

// Em dashes read as AI slop, so we never show them — even if older seeded data
// still contains them. Collapse "X — Y" to "X Y" at render time (the seed
// migrations also clean the underlying data).
export function cleanLabel(s: string): string {
  return s.replace(/\s*—\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

// Give each template a meaningful glyph instead of one generic file icon for
// everything. We match the name first (so each built-in reads at a glance —
// rental gets a house, a trust gets a column, etc.), then fall back to the
// coarse engagement type for anything firm-created.
const NAME_ICONS: Array<[RegExp, LucideIcon]> = [
  [/autonome|self.?employed|t2125|travailleur/, Briefcase],
  [/location|rental|t776|loyer|immeuble/, Home],
  [/finale|succession|deceased|d[eé]c[eè]s|estate/, ScrollText],
  [/fiducie|trust|t3\b/, Landmark],
  [/tps|tvq|tvh|gst|qst|sales.?tax|taxe/, Receipt],
  [/accueil|nouveau.?client|new.?client|onboarding/, UserPlus],
  [/soci[eé]t[eé]|corpo|t2\b/, Building2],
  [/tenue.?de.?livres|bookkeep|comptab/, Calculator],
  [/particulier|individual|personal|t1\b/, UserRound],
];

const TYPE_ICONS: Record<string, LucideIcon> = {
  t1: UserRound,
  t2: Building2,
  bookkeeping: Calculator,
  custom: ClipboardList,
};

export function resolveTemplateIcon(name: string, type: string): LucideIcon {
  const n = name.toLowerCase();
  for (const [re, icon] of NAME_ICONS) if (re.test(n)) return icon;
  return TYPE_ICONS[type] ?? ClipboardList;
}

export type TemplateCardData = {
  name: string;
  type: string;
  itemCount: number;
  requiredCount: number;
  /** First few item labels, already localized — the "peek inside". */
  preview: string[];
};

export function TemplateCard({
  name,
  type,
  itemCount,
  requiredCount,
  preview,
  href,
  footer,
  className,
}: TemplateCardData & {
  /** When set, the whole card is a link (the click-to-use case). */
  href?: string;
  /** Action row rendered at the bottom (the firm-template edit/delete case). */
  footer?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("Templates");
  // Lowercase + createElement: the resolved glyph is a stable lucide component,
  // but assigning it to a capitalized `const` trips react-hooks/static-components.
  const icon = resolveTemplateIcon(name, type);
  const shown = preview.map(cleanLabel).filter(Boolean).slice(0, 3);
  const more = Math.max(0, itemCount - shown.length);

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground">
          {createElement(icon, { className: "h-5 w-5", "aria-hidden": true })}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-snug text-foreground">
            {cleanLabel(name)}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {t("documents_count", { count: itemCount })}
            </span>
            {requiredCount > 0 && (
              <>
                <span className="text-border" aria-hidden>
                  ·
                </span>
                <span className="tabular-nums">
                  {t("required_count", { count: requiredCount })}
                </span>
              </>
            )}
          </p>
        </div>
        {href && (
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors duration-200 group-hover:text-accent"
            aria-hidden
          />
        )}
      </div>

      {shown.length > 0 && (
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/65">
            {t("includes")}{" "}
          </span>
          {shown.join(" · ")}
          {more > 0 && (
            <span className="text-muted-foreground/70">
              {" "}
              {t("plus_more", { count: more })}
            </span>
          )}
        </p>
      )}

      {footer && (
        <div className="mt-3 flex items-center justify-end gap-1 border-t border-border/50 pt-2">
          {footer}
        </div>
      )}
    </>
  );

  const cardClass = cn(
    "group block rounded-xl border border-border/70 bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] motion-reduce:hover:translate-y-0",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={cn(cardClass, "cursor-pointer")}>
        {body}
      </Link>
    );
  }
  return <div className={cardClass}>{body}</div>;
}
