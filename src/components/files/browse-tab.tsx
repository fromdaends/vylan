import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { FilesToolbar } from "@/components/files/files-toolbar";
import { FileBrowser, type BrowserEntry } from "@/components/files/file-browser";
import { PathBar } from "@/components/files/path-bar";
import { ArchiveDownloadZipButton } from "@/components/clients/client-archive/download-zip-button";
import { FilesPagination } from "@/components/files/files-pagination";
import { RecentlyDeleted } from "@/components/files/recently-deleted";
import { FileSelectionProvider } from "@/components/files/file-selection";
import { NewMenu } from "@/components/files/new-menu";
import { FolderRowMenu } from "@/components/files/folder-actions";
import {
  folderDocumentCounts,
  listClientFolders as listCustomFolders,
} from "@/lib/db/folders";
import { childrenOf, folderPath } from "@/lib/files/folder-tree";
import { TrashDropTarget, type DropTarget } from "@/components/files/drag-drop";
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
  listDocumentsByIds,
  searchDocumentContent,
  type BrowseDocument,
  type DocumentSort,
  type ReviewStatus,
} from "@/lib/db/documents";
import { listClientOptions } from "@/lib/db/clients";
import { docMenuMeta } from "@/lib/files/doc-menu-meta";
import type { StatusTone } from "@/components/ui/status-capsule";
import { splitSnippet } from "@/lib/files/search-snippet";
import { getServerSupabase } from "@/lib/supabase/server";
import type { DocType } from "@/lib/db/templates";

// The BROWSE half of /files — the file-manager view.
//
// Lifted OUT of the /files page, unchanged, so the CLIENT page can host the
// same browser on its Files tab. The founder's instruction was literal: "for
// the files it should be the full archive browser — like you're just porting it
// to the client's page." That means this component, rendered twice, not a
// client-shaped imitation of it. The repo's Cohesion rule says the same thing.
//
// It behaves like a file manager, deliberately: ONE list at every level, folder
// rows you click into, a path bar showing where you are. Clients are folders,
// years are folders inside them, categories are folders inside those, and files
// are at the bottom — mirroring the exact folder structure the filing engine
// writes into the firm's cloud storage (Clients/{client}/{year}/{category}).
//
// URL-as-state rather than client state: every folder is linkable and survives
// a reload, and paging needs no JavaScript. `basePath` is what lets the same
// URLs be written under /files or under a client — see buildQuery below.

export async function BrowseTab({
  locale,
  sp,
  basePath = "/files",
  baseParams,
  lockedClientId = null,
  hostedChrome = false,
}: {
  locale: AppLocaleish;
  sp: Record<string, string | undefined>;
  // Where this browser's own links point. /files by default; the client page
  // passes its own route so every folder click stays on the client instead of
  // throwing you out to the firm-wide browser.
  basePath?: string;
  // Params the HOST route needs on every link (the client page's ?tab=files).
  // Kept separate from the browser's own params so the two can never collide:
  // the browser writes client/folder/year/category/q/type/status/sort/view/page
  // and nothing else, so a host param outside that list is safe.
  baseParams?: Record<string, string>;
  // Pins the browser inside ONE client. The client folder level is skipped
  // entirely (you are already in it), and no link can navigate out of it — a
  // browser embedded in a client that could wander to another client's files
  // would be a quiet access surprise, even with RLS behind it.
  lockedClientId?: string | null;
  // True when the HOST page's header already carries the search box and the
  // "+ New" menu (that is /files). The browser then draws neither, so there is
  // exactly one of each on screen.
  //
  // This is the one thing that legitimately differs between the two places
  // this browser renders: /files has a section header with room for them, the
  // client page does not and keeps them inline. Everything below this line —
  // the path bar, the list, sorting, the footer — is identical in both, which
  // is the point of there being one component.
  hostedChrome?: boolean;
}) {
  const t = await getTranslations("Files");
  const tArchive = await getTranslations("Archive");

  const clientId = lockedClientId ?? sp.client?.trim() ?? null;
  const folderId = sp.folder?.trim() || null;
  const search = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const sort: DocumentSort =
    sp.sort === "name" ||
    sp.sort === "size" ||
    sp.sort === "name_desc" ||
    sp.sort === "size_asc" ||
    sp.sort === "date_asc"
      ? sp.sort
      : "date";

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
      view: sp.view ?? null,
      page: sp.page ?? null,
      ...overrides,
    };
    // A locked client is not overridable. Every caller below passes
    // `client: null` when clearing a level, and honouring that inside a client
    // page would drop you out to the firm-wide browser mid-click.
    if (lockedClientId) base.client = lockedClientId;
    for (const [k, v] of Object.entries(base)) if (v) q.set(k, v);
    // The host's params go on LAST so a browser param can never overwrite the
    // one thing the host route needs to still be the right page.
    for (const [k, v] of Object.entries(baseParams ?? {})) q.set(k, v);
    const s = q.toString();
    // A link that clears EVERY param would collapse to a bare /files — which
    // resolves to the HOME tab now, not this browser. The root "Files" crumb
    // did exactly that: clicking it threw you out of the file manager onto the
    // dashboard-ish Home. Any link this browser writes must stay in Browse.
    // Hosted browsers (the client page) always carry baseParams, so only the
    // /files case can collapse.
    if (!s && basePath === "/files") return `${basePath}?tab=browse`;
    return s ? `${basePath}?${s}` : basePath;
  }

  // "The top of this browser" — the firm's client folders normally, and this
  // client's own root when locked. Every crumb and empty-state link uses it, so
  // there is one definition of "go back to the start" rather than a hardcoded
  // /files scattered through the view.
  const rootHref = lockedClientId
    ? buildQuery({ folder: null, year: null, category: null, q: null, page: null })
    : buildQuery({
        client: null,
        folder: null,
        year: null,
        category: null,
        q: null,
        page: null,
      });

  // Files are listed once the user is deep enough to be looking at documents
  // rather than folders: inside a category, or with any document-level filter
  // or a search applied.
  const hasDocumentFilter = !!docType || !!status;
  // A custom folder shows its own contents directly — it is a real folder
  // holding real documents, not a derived bucket to drill further into.
  //
  // `?view=files` is the flat firm-wide document list — what Home's "View all"
  // links to. This used to be inferred from `?sort=` being present, which was
  // fine while sorting only existed once you were already among documents. Now
  // that the CLIENT LIST has a Sort button too, that inference would throw you
  // out of the client folders the moment you sorted them. The intent gets its
  // own param instead of riding on a side effect of another one.
  const showFiles =
    categorySet ||
    hasDocumentFilter ||
    !!search ||
    !!folderId ||
    sp.view === "files";

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
  // Skipped entirely when the host page owns the "+ New" menu: this is a
  // 1000-row query, and fetching it to render nothing is pure latency.
  const importClients = hostedChrome ? [] : await listClientOptions();

  // The path: root → client → year → category. Each ancestor is a link back up,
  // which is how you leave a folder in a file manager.
  // Segments carrying a `drop` double as drag targets — dropping a file on an
  // ancestor is how you move it UP a level, and it is the only way to get a
  // document out of the folder you are currently looking at.
  const segments: { label: string; href?: string; drop?: DropTarget }[] = [
    // Inside a locked client the first crumb IS that client, so the firm-wide
    // "Files" root would be a crumb you can't legitimately click — it would
    // walk you out of the page you're on. It's dropped there and the client's
    // own crumb (pushed below) becomes the root.
    ...(lockedClientId
      ? []
      : [{ label: t("path_root"), href: rootHref } as {
          label: string;
          href?: string;
          drop?: DropTarget;
        }]),
  ];
  if (clientHeader && segments.length > 0) {
    // Inside a client, the root crumb is a legal destination too — it means
    // the top level of this client's files, same as the client's own crumb.
    // "They should be free to put folders wherever they like": with the no-op
    // guard in the move actions, a drop that changes nothing says so instead
    // of inventing a success, so there is no reason left to refuse the drop.
    segments[0].drop = { kind: "folder" as const, folderId: null };
  }
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
      drop: {
        kind: "year" as const,
        year,
        label: yearParam === "unsorted" ? t("unsorted") : String(year),
      },
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
            { label: t("path_root"), href: rootHref },
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
      {/* Sort rides on the path row, beside the folder it sorts, rather than
          in a second strip underneath it — the redesign's one toolbar. */}
      <PathBar
        segments={segments}
        // No "View client profile" link when the browser is EMBEDDED in that
        // client's profile — it would point at the page you are already on.
        // The link earns its place on /files, where the client is a folder you
        // drilled into and their profile is genuinely elsewhere.
        clientProfileId={lockedClientId ? null : (clientHeader?.id ?? null)}
        trailing={
          <>
          {/* DOWNLOAD-EVERYTHING lives on the path row, beside the folder it
              zips — founder: "move download somewhere else it's in a weird
              spot." It used to float on its own right-aligned line ABOVE this
              header, orphaned from the toolbar it belongs to. Sized to match
              the Sort trigger so the two read as one control group, and left
              outline so the blue "+ New" stays the screen's single filled
              button. Only inside a client: there is no "everything" to zip at
              the firm root. */}
          {clientId && (
            <ArchiveDownloadZipButton
              endpoint={`/api/clients/${clientId}/archive`}
              label={tArchive("download_everything")}
              preparingLabel={tArchive("preparing")}
              emptyLabel={tArchive("download_empty")}
              failedLabel={tArchive("download_failed")}
              tooLargeLabel={tArchive("download_too_large")}
              variant="outline"
              size="sm"
              className="h-[34px] rounded-lg px-3 text-[13px] font-medium"
            />
          )}
          <FilesToolbar
            search={search}
            sort={sp.sort ?? "date"}
            docType={sp.type ?? ""}
            status={sp.status ?? ""}
            year={yearParam ?? ""}
            years={firmYears}
            docTypes={docTypeOptions}
            scope={clientId || showFiles ? "documents" : "folders"}
            // On /files the page header carries the one search box. Rendering
            // the toolbar's copy too would put two search fields on one screen
            // writing the same ?q= param.
            hideSearch={hostedChrome}
          />
          </>
        }
      />

      {/* Drive's one entry point for putting things in (§7): Import, and New
          folder when inside a client. On /files this lives in the page header
          instead, so Home can reach it as well. */}
      {!hostedChrome && (
        <div className="flex justify-end">
          <NewMenu
            clients={importClients}
            clientId={clientId}
            folderParentId={folderId}
          />
        </div>
      )}

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
          {/* FOLDERS AND FILES ARE ONE LIST — one header, folders first, the
              way Finder and Drive draw a directory. They used to be two
              stacked tables, each with its own copy of the document columns
              and its own empty-state text; the founder's review of that was
              "why is the name of the folder saying the name of the
              documents?", which is the correct review of two headers.

              Folders stay on screen beside the files because that is what
              makes dragging usable: you cannot drop a file on a folder that
              is off screen. Inside a custom folder these are its sub-folders;
              anywhere else, the client's top-level folders. */}
          <FileList
            folderEntries={
              clientId && bulkFolders
                ? childrenOf(bulkFolders, folderId).map((f) => ({
                    kind: "folder" as const,
                    id: f.id,
                    name: f.name,
                    href: buildQuery({
                      folder: f.id,
                      year: null,
                      category: null,
                      page: null,
                    }),
                    modified: null,
                    actions: (
                      <FolderRowMenu
                        clientId={clientId}
                        folderId={f.id}
                        name={f.name}
                      />
                    ),
                    dropTarget: { kind: "folder" as const, folderId: f.id },
                    dragPayload: {
                      kind: "folder" as const,
                      clientId,
                      folderId: f.id,
                    },
                    manage: { clientId, folderId: f.id },
                  }))
                : []
            }
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
            barFolders={bulkFolders ?? undefined}
          />
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
          sort={sort}
          buildQuery={buildQuery}
        />
      )}

      {/* Footer: what you are looking at on the left, the way into the recycle
          bin on the right. Quiet and at the bottom, like every file manager's
          Trash — findable, never in the way. The bin is also a drop target:
          dragging files onto it soft-deletes them, with an Undo toast. */}
      {/* The count itself is NOT repeated here — FilesPagination already
          renders "N results" directly under the list, and two counts on one
          screen invites them to disagree. */}
      <div className="flex items-center justify-end gap-4 pt-1">
        <TrashDropTarget>
          <Link
            href="/files?deleted=1"
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t("bin_title")}
          </Link>
        </TrashDropTarget>
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
  sort,
  buildQuery,
}: {
  locale: AppLocaleish;
  search: string;
  page: number;
  sort: DocumentSort;
  buildQuery: (o?: Record<string, string | null>) => string;
}) {
  const t = await getTranslations("Files");
  const { folders, total, available } = await listClientFolders({
    search,
    page,
    sort,
  });
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
      dropTarget: {
        kind: "category" as const,
        category: c.category,
        label: c.category ? docTypeGroupLabel(c.category, locale) : t("unsorted"),
        // The year view this row sits inside — dropping a folder here
        // materializes "2025/Bookkeeping & business", not a bare category.
        year,
        yearSet: true,
        yearLabel: year != null ? String(year) : t("unsorted"),
      },
      // Dragging a category folder away NESTS it at the destination: a real
      // folder with this name is created there and the documents go inside.
      dragPayload: {
        kind: "bucket" as const,
        clientId,
        year,
        yearSet: true,
        category: c.category,
        categorySet: true,
        label: c.category ? docTypeGroupLabel(c.category, locale) : t("unsorted"),
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
    manage: { clientId, folderId: f.id },
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
    dropTarget: {
      kind: "year" as const,
      year: y.year,
      label: y.year != null ? String(y.year) : t("unsorted"),
    },
    // Dragging a whole year onto a folder nests it: the destination gains a
    // real "2024" folder with that year's documents inside — "put 2024 in
    // the archive" in one gesture, keeping its name.
    dragPayload: {
      kind: "bucket" as const,
      clientId,
      year: y.year,
      yearSet: true,
      label: y.year != null ? String(y.year) : t("unsorted"),
    },
  }));
  void yearParam;

  // The standalone "New folder" button is gone on purpose: "+ New" already
  // carries it, and two buttons for one act read as clutter next to Drive.
  void foldersAvailable;
  return (
    <div className="space-y-3">
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
  folderEntries = [],
  barFolders,
}: {
  locale: AppLocaleish;
  filters: Parameters<typeof listDocuments>[0];
  showClient: boolean;
  buildHref: (page: number) => string;
  /** Folder rows drawn ABOVE the documents, inside the SAME list — one
   * header, folders first, like a real directory listing. */
  folderEntries?: BrowserEntry[];
  /** Passed through to the selection bar's "File into" control. */
  barFolders?: { id: string; name: string }[];
}) {
  const t = await getTranslations("Files");
  const result = await listDocuments(filters);
  if (!result.available) return <Dormant message={t("unavailable")} />;

  // Content search (Files v2 §5): when there is a query, also look INSIDE
  // documents. Hits the name search already returned get their snippet
  // attached; hits it missed are fetched and appended (page 1 only, so the
  // same document never appears on two pages). Both kinds are labeled — a
  // result that says WHY it matched is the difference between search and
  // guesswork.
  const searchQ = filters.search?.trim() ?? "";
  const snippetByKey = new Map<string, string>();
  let contentOnly: BrowseDocument[] = [];
  if (searchQ) {
    const { hits } = await searchDocumentContent(searchQ);
    for (const h of hits) snippetByKey.set(`${h.source}|${h.documentId}`, h.snippet);
    if (result.page === 1 && hits.length > 0) {
      const have = new Set(result.documents.map((d) => `${d.source}|${d.id}`));
      const missing = hits
        .filter((h) => !have.has(`${h.source}|${h.documentId}`))
        .map((h) => ({ source: h.source, id: h.documentId }));
      contentOnly = await listDocumentsByIds(missing);
    }
  }
  const contentOnlyKeys = new Set(contentOnly.map((d) => `${d.source}|${d.id}`));

  const documents = await attachEngagementContext([
    ...result.documents,
    ...contentOnly,
  ]);

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
    badges: [
      ...fileBadges(doc, t, showClient ? clientNames?.get(doc.clientId) : null),
      // With a query active, every row says WHY it is here.
      ...(searchQ
        ? [
            contentOnlyKeys.has(`${doc.source}|${doc.id}`)
              ? { label: t("match_content"), tone: "accent" as const }
              : { label: t("match_name"), tone: "accent" as const },
          ]
        : []),
    ],
    snippet: (() => {
      const raw = snippetByKey.get(`${doc.source}|${doc.id}`);
      return raw ? splitSnippet(raw) : undefined;
    })(),
    // ONE identity feeds both menus (the ⋯ button and row right-click) —
    // FileBrowser builds them from this so they can never drift apart.
    docMeta: docMenuMeta(doc),
  }));

  return (
    <>
      <FileBrowser
        entries={[...folderEntries, ...entries]}
        locale={locale}
        emptyMessage={t("no_documents")}
        barFolders={barFolders}
      />
      {/* "No results" under a list that plainly shows folders reads as the
          app contradicting itself — the count line only appears when there
          are documents to count, or when the list is truly empty. */}
      {(result.total > 0 || folderEntries.length === 0) && (
        <FilesPagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          buildHref={buildHref}
        />
      )}
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
): { label: string; tone: StatusTone }[] {
  const badges: { label: string; tone: StatusTone }[] =
    [];
  // In firm-wide results the row has to say WHOSE file this is; inside a folder
  // that would be the same value on every row and is left off.
  if (clientName) badges.push({ label: clientName, tone: "muted" });
  // The one badge every surface shows for a hidden-from-client file.
  if (doc.visibility === "firm") {
    badges.push({ label: t("badge_firm_only"), tone: "muted" });
  }
  if (doc.isDuplicate) badges.push({ label: t("badge_duplicate"), tone: "muted" });
  // Only the EXCEPTIONS get a badge. Approved is the resting state of a filed
  // document — badging it would put a coloured pill on almost every row and the
  // rows that actually need attention would stop standing out.
  if (doc.reviewStatus === "rejected") {
    badges.push({ label: t("status_rejected"), tone: "destructive" });
  }
  if (doc.reviewStatus === "pending") {
    badges.push({ label: t("status_pending"), tone: "warning" });
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

