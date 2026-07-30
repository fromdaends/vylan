import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { FilingPanel } from "@/components/filing/filing-panel";
import { FilesToolbar } from "@/components/files/files-toolbar";
import { FileBrowser, type BrowserEntry } from "@/components/files/file-browser";
import { PathBar } from "@/components/files/path-bar";
import { FilesPagination } from "@/components/files/files-pagination";
import { DocumentActionsMenu } from "@/components/files/document-actions-menu";
import { DOC_TYPE_LABELS, docTypeGroupLabel } from "@/lib/doc-types";
import { isBrowseCategory, type BrowseCategory } from "@/lib/files/axes";
import {
  attachEngagementContext,
  getClientDocumentTree,
  getClientHeader,
  listClientFolders,
  listDocuments,
  type BrowseDocument,
  type DocumentSort,
  type ReviewStatus,
} from "@/lib/db/documents";
import { getServerSupabase } from "@/lib/supabase/server";
import type { DocType } from "@/lib/db/templates";

// FILES — the firm-wide document browser.
//
// It behaves like a file manager, deliberately: ONE list at every level, folder
// rows you click into, a path bar showing where you are. Clients are folders,
// years are folders inside them, categories are folders inside those, and files
// are at the bottom — mirroring the exact folder structure the filing engine
// writes into the firm's cloud storage (Clients/{client}/{year}/{category}).
//
//   /files                                    the client folders
//   /files?client=<id>                        that client's year folders
//   /files?client=<id>&year=2024              its category folders
//   /files?client=<id>&year=2024&category=…   the files
//   /files?q=…                                firm-wide search (flat)
//   /files?tab=settings                       the relocated filing settings
//
// URL-as-state rather than client state: every folder is linkable and survives
// a reload, the filing OAuth callbacks land straight on ?tab=settings, and
// paging needs no JavaScript.
export const dynamic = "force-dynamic";

type Tab = "browse" | "settings";

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
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
    <div className="mx-auto w-full max-w-5xl animate-in-fade">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("page_title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          {t("page_subtitle")}
        </p>
      </header>

      <nav
        aria-label={t("page_title")}
        className="mb-6 flex items-center gap-6 border-b border-border"
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
  locale: AppLocaleish;
  sp: Record<string, string | undefined>;
}) {
  const t = await getTranslations("Files");

  const clientId = sp.client?.trim() || null;
  const search = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const sort: DocumentSort =
    sp.sort === "name" || sp.sort === "size" ? sp.sort : "date";

  // "unsorted" is a real folder, not the absence of a filter.
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

  // Files are listed once the user is deep enough to be looking at documents
  // rather than folders: inside a category, or with any document-level filter
  // or a search applied.
  const hasDocumentFilter = !!docType || !!status;
  const showFiles = categorySet || hasDocumentFilter || !!search;

  const docTypeOptions = Object.entries(DOC_TYPE_LABELS)
    .map(([code, meta]) => ({ code, label: meta[locale].split(" — ")[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const nowYear = new Date().getFullYear();
  const firmYears = Array.from({ length: 8 }, (_, i) => nowYear - i);

  const clientHeader = clientId ? await getClientHeader(clientId) : null;

  // The path: root → client → year → category. Each ancestor is a link back up,
  // which is how you leave a folder in a file manager.
  const segments: { label: string; href?: string }[] = [
    { label: t("path_root"), href: "/files" },
  ];
  if (clientHeader) {
    segments.push({
      label: clientHeader.name,
      href: buildQuery({ client: clientHeader.id, year: null, category: null, page: null }),
    });
  }
  if (yearSet) {
    segments.push({
      label: yearParam === "unsorted" ? t("unsorted") : String(year),
      href: buildQuery({ category: null, page: null }),
    });
  }
  if (categorySet) {
    segments.push({
      label: category ? docTypeGroupLabel(category, locale) : t("unsorted"),
    });
  }
  if (search && !clientId) {
    segments.push({ label: t("path_search", { query: search }) });
  }

  return (
    <div className="space-y-4">
      <PathBar segments={segments} clientProfileId={clientHeader?.id ?? null} />

      <FilesToolbar
        search={search}
        sort={sp.sort ?? "date"}
        docType={sp.type ?? ""}
        status={sp.status ?? ""}
        year={yearParam ?? ""}
        years={firmYears}
        docTypes={docTypeOptions}
        scope={clientId || showFiles ? "documents" : "folders"}
      />

      {showFiles ? (
        <FileList
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
          showClient={!clientId}
          buildHref={(p) => buildQuery({ page: p > 1 ? String(p) : null })}
        />
      ) : clientId ? (
        <FolderLevel
          locale={locale}
          clientId={clientId}
          yearSet={yearSet}
          year={year}
          yearParam={yearParam}
          buildQuery={buildQuery}
        />
      ) : (
        <ClientLevel
          locale={locale}
          search={search}
          page={page}
          buildQuery={buildQuery}
        />
      )}
    </div>
  );
}

type AppLocaleish = "en" | "fr";

// ── Level 1: clients as folders ─────────────────────────────────────────────

async function ClientLevel({
  locale,
  search,
  page,
  buildQuery,
}: {
  locale: AppLocaleish;
  search: string;
  page: number;
  buildQuery: (o?: Record<string, string | null>) => string;
}) {
  const t = await getTranslations("Files");
  const { folders, total, available } = await listClientFolders({ search, page });
  if (!available) return <Dormant message={t("unavailable")} />;

  const entries: BrowserEntry[] = folders.map((f) => ({
    kind: "folder",
    id: f.clientId,
    name: f.name,
    href: `/files?client=${f.clientId}`,
    modified: f.lastActivity,
    // The client TYPE, in the same column a file shows its type. Not a count —
    // a filing cabinet does not tell you how many sheets are in a drawer.
    hint: f.clientType === "business" ? t("client_business") : t("client_individual"),
  }));

  return (
    <>
      <FileBrowser
        entries={entries}
        locale={locale}
        emptyMessage={search ? t("empty_search_body", { query: search }) : t("empty_body")}
      />
      <FilesPagination
        page={page}
        pageCount={Math.max(1, Math.ceil(total / 60))}
        total={total}
        buildHref={(p) => buildQuery({ page: p > 1 ? String(p) : null })}
      />
    </>
  );
}

// ── Levels 2 and 3: years, then categories ──────────────────────────────────

async function FolderLevel({
  locale,
  clientId,
  yearSet,
  year,
  yearParam,
  buildQuery,
}: {
  locale: AppLocaleish;
  clientId: string;
  yearSet: boolean;
  year: number | null;
  yearParam: string | undefined;
  buildQuery: (o?: Record<string, string | null>) => string;
}) {
  const t = await getTranslations("Files");
  const { years, available } = await getClientDocumentTree(clientId);
  if (!available) return <Dormant message={t("unavailable")} />;

  // Inside a year: show its category folders. Otherwise: show the year folders.
  if (yearSet) {
    const group = years.find((y) => y.year === year);
    const entries: BrowserEntry[] = (group?.categories ?? []).map((c) => ({
      kind: "folder",
      id: c.category ?? "unsorted",
      name: c.category ? docTypeGroupLabel(c.category, locale) : t("unsorted"),
      href: buildQuery({ category: c.category ?? "unsorted", page: null }),
      modified: c.lastActivity,
    }));
    return (
      <FileBrowser
        entries={entries}
        locale={locale}
        emptyMessage={t("folder_empty")}
      />
    );
  }

  const entries: BrowserEntry[] = years.map((y) => ({
    kind: "folder",
    id: y.year != null ? String(y.year) : "unsorted",
    name: y.year != null ? String(y.year) : t("unsorted"),
    href: buildQuery({
      year: y.year != null ? String(y.year) : "unsorted",
      category: null,
      page: null,
    }),
    modified: y.lastActivity,
  }));
  void yearParam;

  return (
    <FileBrowser
      entries={entries}
      locale={locale}
      emptyMessage={t("client_empty_body")}
    />
  );
}

// ── Level 4: the files ──────────────────────────────────────────────────────

async function FileList({
  locale,
  filters,
  showClient,
  buildHref,
}: {
  locale: AppLocaleish;
  filters: Parameters<typeof listDocuments>[0];
  showClient: boolean;
  buildHref: (page: number) => string;
}) {
  const t = await getTranslations("Files");
  const result = await listDocuments(filters);
  if (!result.available) return <Dormant message={t("unavailable")} />;

  const documents = await attachEngagementContext(result.documents);

  // Client names, only for firm-wide results where rows span clients. One query
  // for the page's clients — the view carries ids, and joining names into it
  // would cost every document read in the product for a column only this shows.
  let clientNames: Map<string, string> | undefined;
  if (showClient && documents.length > 0) {
    const sb = await getServerSupabase();
    const ids = [...new Set(documents.map((d) => d.clientId))];
    const { data } = await sb.from("clients").select("id, display_name").in("id", ids);
    clientNames = new Map(
      ((data ?? []) as Array<{ id: string; display_name: string }>).map((c) => [
        c.id,
        c.display_name,
      ]),
    );
  }

  const entries: BrowserEntry[] = documents.map((doc) => ({
    kind: "file",
    id: `${doc.source}-${doc.id}`,
    name: doc.name,
    modified: doc.createdAt,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    typeLabel: fileTypeLabel(doc, locale, t),
    from: fileSource(doc, t),
    badges: fileBadges(doc, t, showClient ? clientNames?.get(doc.clientId) : null),
    actions: (
      <DocumentActionsMenu
        source={doc.source}
        id={doc.id}
        name={doc.name}
        year={doc.year}
        category={doc.category}
        docType={doc.docType}
        // Move is disabled only while the AI is genuinely mid-read; its answer
        // would land on top of the person's. An imported or never-analysed
        // document is always movable — hand-sorting is the whole point of them.
        canMove={!doc.classificationPending}
        locale={locale}
      />
    ),
  }));

  return (
    <>
      <FileBrowser entries={entries} locale={locale} emptyMessage={t("no_documents")} />
      <FilesPagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        buildHref={buildHref}
      />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Files">>>;

function fileTypeLabel(doc: BrowseDocument, locale: AppLocaleish, t: T): string {
  if (doc.docType) return DOC_TYPE_LABELS[doc.docType][locale].split(" — ")[0];
  if (doc.classificationPending) return t("analyzing");
  return t("unsorted");
}

/**
 * The "From" cell: where this document came from.
 *
 * The spec requires a file whose source engagement was deleted to STILL be
 * listed, with "engagement deleted" where the link would be — so that case is
 * rendered as muted text rather than dropped or linked into the void.
 */
function fileSource(
  doc: BrowseDocument,
  t: T,
): { label: string; href?: string; muted?: boolean } | null {
  if (doc.source === "imported") return { label: t("badge_imported"), muted: true };
  if (doc.source === "final") return { label: t("badge_deliverable"), muted: true };
  if (doc.engagementDeleted) return { label: t("engagement_deleted"), muted: true };
  if (doc.engagementId) {
    return {
      label: doc.engagementTitle || t("engagement_untitled"),
      href: `/engagements/${doc.engagementId}`,
    };
  }
  return null;
}

function fileBadges(
  doc: BrowseDocument,
  t: T,
  clientName: string | null | undefined,
): { label: string; tone: "default" | "outline" | "destructive" | "secondary" }[] {
  const badges: { label: string; tone: "default" | "outline" | "destructive" | "secondary" }[] =
    [];
  // In firm-wide results the row has to say WHOSE file this is; inside a folder
  // that would be the same value on every row and is left off.
  if (clientName) badges.push({ label: clientName, tone: "secondary" });
  if (doc.isDuplicate) badges.push({ label: t("badge_duplicate"), tone: "outline" });
  // Only the EXCEPTIONS get a badge. Approved is the resting state of a filed
  // document — badging it would put a coloured pill on almost every row and the
  // rows that actually need attention would stop standing out.
  if (doc.reviewStatus === "rejected") {
    badges.push({ label: t("status_rejected"), tone: "destructive" });
  }
  if (doc.reviewStatus === "pending") {
    badges.push({ label: t("status_pending"), tone: "outline" });
  }
  return badges;
}

/** Shown when migrations 1070/1080 have not been applied to this environment. */
function Dormant({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
