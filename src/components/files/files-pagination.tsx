import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

// Server-side pagination controls. Plain links, not buttons: each page is a
// real URL, so it is shareable, bookmarkable, and survives a reload — and it
// needs no client JavaScript at all.
export async function FilesPagination({
  page,
  pageCount,
  total,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  /** Given a page number, the href for it (the caller owns the query string). */
  buildHref: (page: number) => string;
}) {
  const t = await getTranslations("Files");
  if (pageCount <= 1) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {t("result_count", { count: total })}
      </p>
    );
  }

  const linkClass =
    "inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const disabledClass =
    "pointer-events-none cursor-default border-border/40 text-muted-foreground/40";

  return (
    <nav
      className="mt-4 flex items-center justify-between gap-4"
      aria-label={t("pagination_label")}
    >
      <p className="text-xs text-muted-foreground">
        {t("result_count", { count: total })}
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={buildHref(page - 1)}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(linkClass, page <= 1 && disabledClass)}
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t("previous")}
        </Link>
        <span className="text-xs text-muted-foreground">
          {t("page_of", { page, pageCount })}
        </span>
        <Link
          href={buildHref(page + 1)}
          aria-disabled={page >= pageCount}
          tabIndex={page >= pageCount ? -1 : undefined}
          className={cn(linkClass, page >= pageCount && disabledClass)}
        >
          {t("next")}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
