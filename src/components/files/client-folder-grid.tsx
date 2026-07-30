import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Building2, Folder, User } from "lucide-react";
import { formatDate, type AppLocale } from "@/lib/format";
import type { ClientFolder } from "@/lib/db/documents";

// LEVEL 1 of the browser: every client that has documents, as a folder.
//
// Deliberately NOT a second Clients page. It shows a name, a type, a count and
// a date — nothing else. No contact details, no engagement controls, no edit
// affordance. The spec is explicit that Files must not duplicate Clients, and
// the discipline that keeps that true is having nothing else available here to
// render.
export async function ClientFolderGrid({
  folders,
  locale,
  searchQuery,
}: {
  folders: ClientFolder[];
  locale: AppLocale;
  searchQuery: string;
}) {
  const t = await getTranslations("Files");

  if (folders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-6 py-14 text-center">
        <Folder className="mx-auto size-8 text-muted-foreground/50" aria-hidden />
        <p className="mt-3 text-sm font-medium">
          {searchQuery ? t("empty_search_title") : t("empty_title")}
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          {searchQuery
            ? t("empty_search_body", { query: searchQuery })
            : t("empty_body")}
        </p>
        {!searchQuery && (
          <Link
            href="/engagements/new"
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            {t("empty_cta")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {folders.map((folder) => {
        const Icon = folder.clientType === "business" ? Building2 : User;
        return (
          <li key={folder.clientId}>
            <Link
              href={`/files?client=${folder.clientId}`}
              className="group flex h-full items-start gap-3 rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{folder.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {folder.clientType === "business"
                    ? t("client_business")
                    : t("client_individual")}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {t("folder_count", { count: folder.documentCount })}
                  {folder.lastActivity ? (
                    <>
                      {" · "}
                      {t("folder_last", {
                        date: formatDate(folder.lastActivity, locale, "short"),
                      })}
                    </>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
