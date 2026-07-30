import { Link } from "@/i18n/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";

// The path bar — "Files › TEST — Acme Corp › 2025 › Bookkeeping & business".
//
// This is file-manager chrome, not site navigation. Worth stating plainly
// because the product deliberately removed breadcrumb navigation (the shared
// Breadcrumb component is a no-op that renders null) and a future reader will
// otherwise assume this is that pattern sneaking back. It isn't: a file browser
// with no path is unusable — you cannot tell which folder you are in, and you
// cannot get back out one level. Explorer, Finder and Drive all have one.
export async function PathBar({
  segments,
  clientProfileId,
}: {
  /** Root first. The last segment is the current folder and is not a link. */
  segments: { label: string; href?: string }[];
  /** When inside a client, the id for the one allowed cross-link to Clients. */
  clientProfileId?: string | null;
}) {
  const t = await getTranslations("Files");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <nav aria-label={t("path_label")} className="flex min-w-0 items-center">
        <ol className="flex min-w-0 flex-wrap items-center gap-0.5">
          {segments.map((seg, i) => {
            const last = i === segments.length - 1;
            return (
              <li key={`${seg.label}-${i}`} className="flex min-w-0 items-center">
                {i > 0 && (
                  <ChevronRight
                    className="mx-0.5 size-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                )}
                {seg.href && !last ? (
                  <Link
                    href={seg.href}
                    className="truncate rounded px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {seg.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={cn(
                      "truncate px-1.5 py-1 text-sm",
                      last ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {seg.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {clientProfileId && (
        <Link
          href={`/clients/${clientProfileId}`}
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("view_client_profile")}
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
