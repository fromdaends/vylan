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
import { RecentlyDeleted } from "@/components/files/recently-deleted";
import { FileSelectionProvider } from "@/components/files/file-selection";
import { BulkBar } from "@/components/files/bulk-bar";
import { ImportWizard } from "@/components/files/import-wizard";
import {
  FolderRowMenu,
  NewFolderButton,
} from "@/components/files/folder-actions";
import {
  folderDocumentCounts,
  listClientFolders as listCustomFolders,
} from "@/lib/db/folders";
import { childrenOf, folderPath } from "@/lib/files/folder-tree";
import type { DropTarget } from "@/components/files/drag-drop";
import { DOCUMENT_RETENTION_DAYS } from "@/lib/files/purge";
import { Trash2 } from "lucide-react";
import { DOC_TYPE_LABELS, docTypeGroupLabel } from "@/lib/doc-types";
import { isBrowseCategory, type BrowseCategory } from "@/lib/files/axes";
import {
  attachEngagementContext,
  getClientDocumentTree,
  getClientHeader,
  listClientFolders,
  listDeletedDocuments,
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
  const folderId = sp.folder?.trim() || null;
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
      folder: folderId,
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
  // A custom folder shows its own contents directly — it is a real folder
  // holding real documents, not a derived bucket to drill further into.
  const showFiles = categorySet || hasDocumentFilter || !!search || !!folderId;

  const docTypeOptions = Object.entries(DOC_TYPE_LABELS)
    .map(([code, meta]) => ({ code, label: meta[locale].split(" — ")[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const nowYear = new Date().getFullYear();
  const firmYears = Array.from({ length: 8 }, (_, i) => nowYear - i);

  const clientHeader = clientId ? await getClientHeader(clientId) : null;
  // Custom folders for the bulk bar's "file into" control. Only meaningful
  // inside a client — firm-wide results span clients, and a folder belongs
  // to exactly one of them.
  // parentId rides along because the path bar needs the whole chain, not just
  // a flat list of names.
  const bulkFolders = clientId
    ? (await listCustomFolders(clientId)).folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
      }))
    : undefined;

  // Every client the firm can see — the import wizard maps folders onto these.
  // Deliberately NOT the folder list from the RPC: that only includes clients
  // who already have documents, and importing history is exactly how a client
  // with none gets their first.
  const { data: allClients } = await (await getServerSupabase())
    .from("clients")
    .select("id, display_name")
    .order("display_name", { ascending: true })
    .limit(1000);
  const importClients = ((allClients ?? []) as Array<{ id: string; display_name: string }>)
    .map((c) => ({ id: c.id, name: c.display_name }));

  // The path: root → client → year → category. Each ancestor is a link back up,
  // which is how you leave a folder in a file manager.
  // Segments carrying a `drop` double as drag targets — dropping a file on an
  // ancestor is how you move it UP a level, and it is the only way to get a
  // document out of the folder you are currently looking at.
  const segments: { label: string; href?: string; drop?: DropTarget }[] = [
    { label: t("path_root"), href: "/files" },
  ];
  if (clientHeader) {
    segments.push({
      label: clientHeader.name,
      href: buildQuery({ client: clientHeader.id, folder: null, year: null, category: null, page: null }),
      // Dropping on the client takes a document OUT of whatever folder it is
      // in — the only way to move something back to the top level.
      drop: { kind: "folder" as const, folderId: null },
    });
  }
  // A custom folder's own chain, root-first. Without this the path bar stops at
  // the client and there is no way to tell which folder you are looking at —
  // the one thing a file manager's path exists to answer.
  if (folderId && bulkFolders) {
    for (const node of folderPath(
      bulkFolders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name })),
      folderId,
    )) {
      segments.push({
        label: node.name,
        href: buildQuery({ folder: node.id, year: null, category: null, page: null }),
        drop: { kind: "folder" as const, folderId: node.id },
      });
    }
  }
  if (yearSet) {
    segments.push({
      label: yearParam === "unsorted" ? t("unsorted") : String(year),
      href: buildQuery({ category: null, page: null }),
      drop: { kind: "year" as const, year },
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

  // The recycle bin. A view of the Browse tab rather than a third top-level
  // tab: the spec caps the section at Browse + Filing settings, and this is
  // "somewhere inside Browse" the way Finder's Trash is part of the file
  // manager rather than a separate application.
  if (sp.deleted === "1") {
    const { documents, available } = await listDeletedDocuments(
      DOCUMENT_RETENTION_DAYS,
    );
    return (
      <div className="space-y-4">
        <PathBar
          segments={[
            { label: t("path_root"), href: "/files" },
            { label: t("bin_title") },
          ]}
        />
        {available ? (
          <RecentlyDeleted
            documents={documents}
            locale={locale}
            retentionDays={DOCUMENT_RETENTION_DAYS}
          />
        ) : (
          <Dormant message={t("unavailable")} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PathBar segments={segments} clientProfileId={clientHeader?.id ?? null} />

      {/* Import sits beside the search, per the spec — and is the ONLY way
          documents enter Vylan outside the engagement/portal pipeline. There is
          deliberately no plain "upload file" action anywhere on Browse. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <ImportWizard clients={importClients} />
      </div>

      {/* Selection only wraps the FILE list. Folder rows are navigation, and a
          checkbox on a folder would promise a bulk action on its contents that
          this does not do. */}
      {showFiles ? (
        <FileSelectionProvider>
          {/* A custom folder shows its SUB-FOLDERS above its files. Without
              this, a folder created inside another one was invisible — and
              there was nothing on screen to drag a file onto, which is why
              drag-and-drop appeared not to work at all: the gesture was fine,
              there was simply never a drop target in view. */}
          {/* FOLDERS ARE ALWAYS ON SCREEN BESIDE THE FILES.

              This is what makes dragging usable. The mechanism worked before
              this — verified end to end on production — but at the deepest
              level (inside a category) the ONLY drop targets were the small
              path-bar links at the top of the page. A gesture whose target is
              a 100px text link you have to know about is a gesture nobody
              discovers. Drive shows folders and files in one list; so does
              this now.

              Inside a custom folder these are its sub-folders; anywhere else
              they are the client's own folders, which is where you would want
              to drag something anyway. */}
          {clientId && bulkFolders && (
            <SubfolderList
              locale={locale}
              clientId={clientId}
              folders={bulkFolders}
              parentId={folderId}
              buildQuery={buildQuery}
            />
          )}
          <FileList
            locale={locale}
            filters={{
              clientId,
              year,
              yearSet,
              category,
              categorySet,
              // Three states, and the difference is the whole bug that made a
              // move look like it did nothing:
              //   a folder      → that folder's contents
              //   null          → the top level only, so a document filed into
              //                   a folder leaves the year/category list it
              //                   came from instead of sitting in both
              //   undefined     → everywhere, for SEARCH and for the type and
              //                   status filters. Those are "find me this",
              //                   and a find that cannot see inside folders is
              //                   worse than no find at all.
              folderId: folderId ?? (search || hasDocumentFilter ? undefined : null),
              docTypes: docType ? [docType] : undefined,
              statuses: status ? [status] : undefined,
              search,
              sort,
              page,
            }}
            showClient={!clientId}
            buildHref={(p) => buildQuery({ page: p > 1 ? String(p) : null })}
          />
          <BulkBar locale={locale} folders={bulkFolders} />
        </FileSelectionProvider>
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

      {/* The way into the recycle bin. Quiet and at the bottom, like every file
          manager's Trash — findable, never in the way. */}
      <div className="pt-2">
        <Link
          href="/files?deleted=1"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash2 className="size-3.5" aria-hidden />
          {t("bin_title")}
        </Link>
      </div>
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

/**
 * The sub-folders of the folder you are currently inside.
 *
 * Rendered ABOVE that folder's files, so a folder can hold both — which is what
 * every file manager does, and what makes dragging possible: you cannot drop a
 * file on a folder that is one level up and off screen.
 *
 * Nothing renders when the folder has no children, so a plain folder of
 * documents does not grow an empty header.
 */
async function SubfolderList({
  locale,
  clientId,
  folders,
  parentId,
  buildQuery,
}: {
  locale: AppLocaleish;
  clientId: string;
  folders: { id: string; name: string; parentId: string | null }[];
  /** Inside a folder: its children. Null (anywhere else in the client): the
   * client's top-level folders, so there is always a drop target on screen. */
  parentId: string | null;
  buildQuery: (o?: Record<string, string | null>) => string;
}) {
  const t = await getTranslations("Files");
  const children = childrenOf(folders, parentId);
  // No folders yet — but the New folder button still shows, because "there is
  // nowhere to put this file" is exactly when someone wants to make one.
  if (children.length === 0 && !parentId) {
    return (
      <div className="flex justify-end">
        <NewFolderButton clientId={clientId} parentId={null} />
      </div>
    );
  }
  if (children.length === 0) return null;

  const entries: BrowserEntry[] = children.map((f) => ({
    kind: "folder" as const,
    id: f.id,
    name: f.name,
    href: buildQuery({ folder: f.id, year: null, category: null, page: null }),
    modified: null,
    actions: <FolderRowMenu clientId={clientId} folderId={f.id} name={f.name} />,
    dropTarget: { kind: "folder" as const, folderId: f.id },
    // Draggable: drop it on another folder to nest it, or on the client in the
    // path bar to bring it back to the top level.
    dragPayload: { kind: "folder" as const, clientId, folderId: f.id },
  }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <NewFolderButton clientId={clientId} parentId={parentId} />
      </div>
      <FileBrowser
        entries={entries}
        locale={locale}
        emptyMessage={t("folder_empty")}
      />
    </div>
  );
}

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

  // CUSTOM FOLDERS. Real folders the firm made, shown above the derived
  // year folders. A document only appears in the derived view while it has not
  // been filed into one of these by hand, so nothing a firm already relies on
  // disappears the moment they create their first folder.
  const { folders, available: foldersAvailable } = await listCustomFolders(clientId);
  const counts = foldersAvailable ? await folderDocumentCounts(clientId) : new Map();

  // Inside a year: show its category folders. Otherwise: show the year folders.
  if (yearSet) {
    const group = years.find((y) => y.year === year);
    const entries: BrowserEntry[] = (group?.categories ?? []).map((c) => ({
      kind: "folder",
      id: c.category ?? "unsorted",
      name: c.category ? docTypeGroupLabel(c.category, locale) : t("unsorted"),
      href: buildQuery({ category: c.category ?? "unsorted", page: null }),
      modified: c.lastActivity,
      // Dropping documents on a category folder sets their category — the same
      // gesture as dropping on a custom folder, because to the person dragging
      // there is no difference between the two.
      dropTarget: { kind: "category" as const, category: c.category },
      // Dragging a category folder AWAY moves everything in it. There is no
      // row to re-parent — the folder is computed from the documents — so the
      // only honest meaning for the gesture is "put this lot over there".
      dragPayload: {
        kind: "bucket" as const,
        clientId,
        year,
        yearSet: true,
        category: c.category,
        categorySet: true,
      },
    }));
    return (
      <FileBrowser
        entries={entries}
        locale={locale}
        emptyMessage={t("folder_empty")}
      />
    );
  }

  // Custom folders first — they are the firm's own structure, and burying them
  // under a list of years would make the feature feel like an afterthought.
  const customEntries: BrowserEntry[] = childrenOf(folders, null).map((f) => ({
    kind: "folder" as const,
    id: f.id,
    name: f.name,
    href: buildQuery({ folder: f.id, year: null, category: null, page: null }),
    modified: null,
    hint: t("folder_item_count", { count: counts.get(f.id) ?? 0 }),
    dropTarget: { kind: "folder" as const, folderId: f.id },
    dragPayload: { kind: "folder" as const, clientId, folderId: f.id },
    actions: (
      <FolderRowMenu clientId={clientId} folderId={f.id} name={f.name} />
    ),
  }));

  const yearEntries: BrowserEntry[] = years.map((y) => ({
    kind: "folder" as const,
    id: y.year != null ? String(y.year) : "unsorted",
    name: y.year != null ? String(y.year) : t("unsorted"),
    href: buildQuery({
      year: y.year != null ? String(y.year) : "unsorted",
      category: null,
      page: null,
    }),
    modified: y.lastActivity,
    // Dropping on a year folder sets the year. "Unsorted" is a real
    // destination too — y.year is null there, which the drop handler sends as
    // the Unsorted bucket rather than as "leave it alone".
    dropTarget: { kind: "year" as const, year: y.year },
    // Dragging a whole year onto a custom folder files that year's documents
    // there — "put 2024 in the archive folder" in one gesture.
    dragPayload: {
      kind: "bucket" as const,
      clientId,
      year: y.year,
      yearSet: true,
    },
  }));
  void yearParam;

  return (
    <div className="space-y-3">
      {foldersAvailable && (
        <div className="flex justify-end">
          <NewFolderButton clientId={clientId} parentId={null} />
        </div>
      )}
      <FileBrowser
        entries={[...customEntries, ...yearEntries]}
        locale={locale}
        emptyMessage={t("client_empty_body")}
      />
    </div>
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
    selectSource: doc.source,
    selectId: doc.id,
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
