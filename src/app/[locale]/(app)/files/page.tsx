import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { FilingPanel } from "@/components/filing/filing-panel";
import { FilesToolbar } from "@/components/files/files-toolbar";
import { ClientFolderGrid } from "@/components/files/client-folder-grid";
import { YearTree } from "@/components/files/year-tree";
import { DocumentTable } from "@/components/files/document-table";
import { FilesPagination } from "@/components/files/files-pagination";
import { DOC_TYPE_LABELS, docTypeGroupLabel } from "@/lib/doc-types";
import { isBrowseCategory, type BrowseCategory } from "@/lib/files/axes";
import {
  attachEngagementContext,
  getClientDocumentTree,
  getClientHeader,
  listClientFolders,
  listDocuments,
  type DocumentSort,
  type ReviewStatus,
} from "@/lib/db/documents";
import { getServerSupabase } from "@/lib/supabase/server";
import type { DocType } from "@/lib/db/templates";

// FILES — the firm-wide document browser.
//
// Every level of the drill-down is ONE server-rendered route driven by search
// params, matching the /vylan hub's ?tab= pattern:
//
//   /files                                  all clients, as folders
//   /files?client=<id>                      that client's years -> categories
//   /files?client=<id>&year=2024&category=… the flat file list
//   /files?q=…                              firm-wide document search
//   /files?tab=settings                     the relocated Document filing page
//
// URL-as-state rather than client state: every view is linkable and survives a
// reload, the filing OAuth callbacks can land straight on ?tab=settings, and
// pagination needs no JavaScript.
export const dynamic = "force-dynamic";

type Tab = "browse" | "settings";

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    tab?: string;
    client?: string;
    year?: string;
    category?: string;
    q?: string;
    type?: string;
    status?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Files");
  const sp = await searchParams;

  const tab: Tab = sp.tab === "settings" ? "settings" : "browse";
  const tabs: { id: Tab; label: string; href: string }[] = [
    { id: "browse", label: t("tab_browse"), href: "/files" },
    { id: "settings", label: t("tab_settings"), href: "/files?tab=settings" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl animate-in-fade">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("page_title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          {t("page_subtitle")}
        </p>
      </header>

      {/* Underlined tab strip — the same pattern the Vylan hub and Engagements
          already use, so this reads as part of the app rather than a new idea. */}
      <nav
        aria-label={t("page_title")}
        className="mb-8 flex items-center gap-6 border-b border-border"
      >
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {tab === "settings" ? (
        <div className="max-w-4xl">
          <FilingPanel />
        </div>
      ) : (
        <BrowseTab locale={locale} sp={sp} />
      )}
    </div>
  );
}

// ── Browse ──────────────────────────────────────────────────────────────────

async function BrowseTab({
  locale,
  sp,
}: {
  locale: "en" | "fr";
  sp: {
    client?: string;
    year?: string;
    category?: string;
    q?: string;
    type?: string;
    status?: string;
    sort?: string;
    page?: string;
  };
}) {
  const t = await getTranslations("Files");

  const clientId = sp.client?.trim() || null;
  const search = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const sort: DocumentSort =
    sp.sort === "name" || sp.sort === "size" ? sp.sort : "date";

  // "unsorted" is a real bucket, not the absence of a filter — hence the
  // separate *Set flags all the way down into the query builder.
  const yearParam = sp.year?.trim();
  const yearSet = !!yearParam;
  const year = yearParam === "unsorted" ? null : Number(yearParam) || null;

  const categoryParam = sp.category?.trim();
  const categorySet = !!categoryParam;
  const category: BrowseCategory | null = isBrowseCategory(categoryParam)
    ? categoryParam
    : null;

  const docType = sp.type && sp.type in DOC_TYPE_LABELS ? (sp.type as DocType) : null;
  const status: ReviewStatus | null =
    sp.status === "approved" || sp.status === "pending" || sp.status === "rejected"
      ? sp.status
      : null;

  // A flat document list is shown whenever the user has narrowed to something
  // more specific than "which clients do I have": inside a year/category, or
  // with any document-level filter or search applied firm-wide.
  const hasDocumentFilter =
    yearSet || categorySet || !!docType || !!status || (!clientId && !!search);
  const showDocuments = hasDocumentFilter || (!!clientId && !!search);

  const toolbarScope = !clientId && !hasDocumentFilter ? "folders" : "documents";

  // Year options for the filter, taken from the client's own tree when we are
  // inside one. Firm-wide we offer a plain recent-years range rather than a
  // second aggregate query for something nobody scrolls.
  const nowYear = new Date().getFullYear();
  const firmYears = Array.from({ length: 8 }, (_, i) => nowYear - i);

  const docTypeOptions = Object.entries(DOC_TYPE_LABELS)
    .map(([code, meta]) => ({ code, label: meta[locale].split(" — ")[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const clientHeader = clientId ? await getClientHeader(clientId) : null;

  function buildQuery(overrides: Record<string, string | null> = {}): string {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = {
      client: clientId,
      year: yearParam ?? null,
      category: categoryParam ?? null,
      q: search || null,
      type: sp.type ?? null,
      status: sp.status ?? null,
      sort: sp.sort ?? null,
      page: sp.page ?? null,
      ...overrides,
    };
    for (const [k, v] of Object.entries(base)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/files?${s}` : "/files";
  }

  return (
    <div className="space-y-5">
      {/* Where am I / how do I get back. Deliberately NOT a breadcrumb: the
          Breadcrumb component is a site-wide no-op (it renders null — breadcrumb
          navigation was removed from this product on purpose), so reviving the
          pattern here would have been a lone exception rather than consistency. */}
      {clientHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={buildQuery({ client: null, year: null, category: null, page: null })}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden />
              {t("back_to_clients")}
            </Link>
            <h2 className="truncate text-lg font-semibold">{clientHeader.name}</h2>
          </div>
          {/* One of exactly two cross-links between Files and Clients. */}
          <Link
            href={`/clients/${clientHeader.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("view_client_profile")}
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
      )}

      {/* Inside a year/category, offer the way back up to the client's tree. */}
      {clientHeader && (yearSet || categorySet) && (
        <p className="text-sm text-muted-foreground">
          <Link
            href={buildQuery({ year: null, category: null, page: null })}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("back_to_all_years")}
          </Link>
          {" · "}
          {yearParam === "unsorted" ? t("unsorted") : year}
          {category ? ` · ${docTypeGroupLabel(category, locale)}` : null}
          {categoryParam === "unsorted" ? ` · ${t("unsorted")}` : null}
        </p>
      )}

      <FilesToolbar
        search={search}
        sort={sp.sort ?? "date"}
        docType={sp.type ?? ""}
        status={sp.status ?? ""}
        year={yearParam ?? ""}
        years={firmYears}
        docTypes={docTypeOptions}
        scope={toolbarScope}
      />

      {showDocuments ? (
        <DocumentList
          locale={locale}
          filters={{
            clientId,
            year,
            yearSet,
            category,
            categorySet,
            docTypes: docType ? [docType] : undefined,
            statuses: status ? [status] : undefined,
            search,
            sort,
            page,
          }}
          showClientColumn={!clientId}
          buildHref={(p) => buildQuery({ page: p > 1 ? String(p) : null })}
        />
      ) : clientId ? (
        <ClientTreeView clientId={clientId} locale={locale} />
      ) : (
        <FolderList locale={locale} search={search} page={page} buildQuery={buildQuery} />
      )}
    </div>
  );
}

async function FolderList({
  locale,
  search,
  page,
  buildQuery,
}: {
  locale: "en" | "fr";
  search: string;
  page: number;
  buildQuery: (o?: Record<string, string | null>) => string;
}) {
  const t = await getTranslations("Files");
  const { folders, total, available } = await listClientFolders({ search, page });
  if (!available) return <Dormant message={t("unavailable")} />;
  return (
    <>
      <ClientFolderGrid folders={folders} locale={locale} searchQuery={search} />
      <FilesPagination
        page={page}
        pageCount={Math.max(1, Math.ceil(total / 60))}
        total={total}
        buildHref={(p) => buildQuery({ page: p > 1 ? String(p) : null })}
      />
    </>
  );
}

async function ClientTreeView({
  clientId,
  locale,
}: {
  clientId: string;
  locale: "en" | "fr";
}) {
  const t = await getTranslations("Files");
  const { years, available } = await getClientDocumentTree(clientId);
  if (!available) return <Dormant message={t("unavailable")} />;
  return <YearTree clientId={clientId} years={years} locale={locale} />;
}

async function DocumentList({
  locale,
  filters,
  showClientColumn,
  buildHref,
}: {
  locale: "en" | "fr";
  filters: Parameters<typeof listDocuments>[0];
  showClientColumn: boolean;
  buildHref: (page: number) => string;
}) {
  const t = await getTranslations("Files");
  const result = await listDocuments(filters);
  if (!result.available) return <Dormant message={t("unavailable")} />;

  const documents = await attachEngagementContext(result.documents);

  // Client names for firm-wide results. One query for the page's clients only —
  // the view carries ids, and joining names into it would cost every read in
  // the product for a column only this view shows.
  let clientNames: Map<string, string> | undefined;
  if (showClientColumn && documents.length > 0) {
    const sb = await getServerSupabase();
    const ids = [...new Set(documents.map((d) => d.clientId))];
    const { data } = await sb
      .from("clients")
      .select("id, display_name")
      .in("id", ids);
    clientNames = new Map(
      ((data ?? []) as Array<{ id: string; display_name: string }>).map((c) => [
        c.id,
        c.display_name,
      ]),
    );
  }

  return (
    <>
      <DocumentTable
        documents={documents}
        locale={locale}
        showClientColumn={showClientColumn}
        clientNames={clientNames}
      />
      <FilesPagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        buildHref={buildHref}
      />
    </>
  );
}

/** Shown when migrations 1070/1080 have not been applied to this environment. */
function Dormant({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
