import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ChevronRight, FolderOpen } from "lucide-react";
import { docTypeGroupLabel } from "@/lib/doc-types";
import type { YearGroup } from "@/lib/db/documents";

// LEVEL 2: one client's documents, grouped by year and then by category —
// mirroring the folder structure the filing engine actually writes into the
// firm's cloud storage (Clients/{client}/{year}/{category}).
//
// The newest year is expanded by default and the rest are collapsed. That is
// the whole ergonomic point: an accountant opening a client is almost always
// working on the current file, not spelunking 2019.
//
// Built on <details>/<summary> rather than React state so it works server-
// rendered with no hydration, and so a keyboard or screen-reader user gets the
// native disclosure semantics for free.
export async function YearTree({
  clientId,
  years,
  locale,
}: {
  clientId: string;
  years: YearGroup[];
  locale: "en" | "fr";
}) {
  const t = await getTranslations("Files");

  if (years.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
        <FolderOpen className="mx-auto size-7 text-muted-foreground/50" aria-hidden />
        <p className="mt-3 text-sm text-muted-foreground">
          {t("client_empty_body")}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
      {years.map((group, index) => {
        const yearLabel = group.year != null ? String(group.year) : t("unsorted");
        const yearHref =
          group.year != null
            ? `/files?client=${clientId}&year=${group.year}`
            : `/files?client=${clientId}&year=unsorted`;
        return (
          <details
            key={group.year ?? "unsorted"}
            // Newest first is guaranteed by the data layer's ordering, so
            // "index 0" is "the most recent year" — including when that is the
            // Unsorted bucket, which only happens when it is all a client has.
            open={index === 0}
            className="group/year bg-card"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/year:rotate-90 motion-reduce:transition-none"
                aria-hidden
              />
              <span>{yearLabel}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t("folder_count", { count: group.count })}
              </span>
            </summary>
            <ul className="border-t border-border/50 bg-muted/20 px-4 py-2">
              {group.categories.map((cat) => (
                <li key={cat.category ?? "unsorted"}>
                  <Link
                    href={`${yearHref}&category=${cat.category ?? "unsorted"}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderOpen
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate">
                        {cat.category
                          ? docTypeGroupLabel(cat.category, locale)
                          : t("unsorted")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {cat.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
