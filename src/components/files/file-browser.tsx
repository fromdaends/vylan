import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDate, type AppLocale } from "@/lib/format";
import type { SnippetPart } from "@/lib/files/search-snippet";
import { RowCheckbox } from "./row-checkbox";
import { RowsSurface, SelectableRow } from "./selectable-row";
import {
  DocumentActionsMenu,
  DocumentRowContextMenu,
  type DocumentMenuMeta,
} from "./document-actions-menu";
import {
  DraggableFile,
  DraggableFolder,
  FolderDropTarget,
  type DragPayload,
  type DropTarget,
} from "./drag-drop";

// THE FILE BROWSER — one list, used at every level of the drill-down.
//
// This replaced three different layouts (a card grid for clients, an accordion
// for years, a data table for files). The founder's note was that it should
// behave "like a literal filing system — like when you open your files on a
// computer or on Google Drive", and the thing that makes Finder or Drive read as
// a filing system is not any single screen: it is that EVERY level looks the
// same. One list, folders you click into, the same columns throughout. Three
// bespoke layouts is a dashboard about documents; one repeated list is a
// filing cabinet.
//
// Deliberately NO item counts on folders. Explorer and Drive do not show
// "42 documents" next to a folder, and the founder asked for them gone — a
// count is a statistic, and a filing cabinet does not report statistics at you.
// The Modified date stays, because that is a real file-manager column and it is
// what "which of these did we touch last" is answered with.

export type BrowserEntry =
  | {
      kind: "folder";
      /** Stable key within the list. */
      id: string;
      name: string;
      href: string;
      /** Newest document inside — the folder's Modified date. */
      modified: string | null;
      /** Optional right-aligned hint, e.g. the client type. */
      hint?: string | null;
      /** Rename/delete menu, for folders the firm made themselves. */
      actions?: React.ReactNode;
      /** What dropping documents on this folder does. EVERY folder is a drop
       * target: a custom one re-files, a year sets the year, a category sets
       * the category. */
      dropTarget?: DropTarget;
      /**
       * What dragging this folder AWAY does. Folders are draggable too — a
       * custom folder re-parents itself, a year or category folder moves its
       * contents. Omitted for rows that cannot move (a client), and those rows
       * are then simply not draggable.
       */
      dragPayload?: DragPayload | null;
      /** Rename/delete identity for the selection bar — only for folders the
       * firm made. Derived rows (clients, years, categories) have none. */
      manage?: { clientId: string; folderId: string } | null;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      /** Absent until the preview route lands (PR 3). */
      href?: string;
      modified: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      typeLabel: string | null;
      /**
       * Where the document came from — the source engagement, linked. `muted`
       * renders it as plain italic text instead: that is the "engagement
       * deleted" case, where the file must still be listed but there is nothing
       * left to link to.
       */
      from?: { label: string; href?: string; muted?: boolean } | null;
      /** Small trailing badges: status, Imported, Duplicate… */
      badges?: { label: string; tone: "default" | "outline" | "destructive" | "secondary" }[];
      /** Custom actions node (the recycle bin's Restore). Regular file rows
       * pass `docMeta` instead and get the ⋯ menu AND right-click for free. */
      actions?: React.ReactNode;
      /** The document identity the shared actions menus need. When present,
       * the row renders the ⋯ menu in its actions cell and the whole row
       * becomes a right-click target with the SAME items. */
      docMeta?: Omit<DocumentMenuMeta, "locale">;
      /** Identity for multi-select. Both are needed: an id is only unique
       * within its own table, so selection is keyed on the pair. */
      selectSource?: string;
      selectId?: string;
      /** Content-search context (Files v2 §5): where the query matched INSIDE
       * the document. Pre-split — matched words render as <mark> elements,
       * never as HTML, because this text comes from uploaded documents. */
      snippet?: SnippetPart[];
    };

// File-type icon, the way a file manager picks one: by what the file IS, not by
// what the app thinks it means. A firm scrolling a folder recognises the shape
// before it reads the name.
function iconForMime(mime: string | null): LucideIcon {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return FileImage;
  if (
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m === "text/csv" ||
    m.endsWith(".sheet")
  ) {
    return FileSpreadsheet;
  }
  if (m === "application/pdf" || m.startsWith("text/") || m.includes("word")) {
    return FileText;
  }
  return File;
}

/** Wraps a file row in the right-click menu when it carries its document
 * identity. The plain div is the ContextMenuTrigger's `asChild` target —
 * Radix needs a child that accepts the handlers it clones on. */
function MaybeRowContext({
  meta,
  locale,
  children,
}: {
  meta?: Omit<DocumentMenuMeta, "locale">;
  locale: AppLocale;
  children: React.ReactNode;
}) {
  if (!meta) return <>{children}</>;
  return (
    <DocumentRowContextMenu {...meta} locale={locale}>
      <div>{children}</div>
    </DocumentRowContextMenu>
  );
}

/** Wraps a row in a drop target only when it declares one. */
function MaybeDropTarget({
  drop,
  label,
  children,
}: {
  drop?: DropTarget;
  label: string;
  children: React.ReactNode;
}) {
  if (!drop) return <>{children}</>;
  return (
    <FolderDropTarget target={drop} label={label}>
      {children}
    </FolderDropTarget>
  );
}

export async function FileBrowser({
  entries,
  locale,
  emptyMessage,
  barFolders,
}: {
  entries: BrowserEntry[];
  locale: AppLocale;
  emptyMessage: string;
  /** The current client's custom folders, for the selection bar's
   * "File into" control. */
  barFolders?: { id: string; name: string }[];
}) {
  const t = await getTranslations("Files");

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-card">
        <BrowserHeader t={t} />
        <p className="px-4 py-14 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    /* `relative` because the selection strip OVERLAYS the column header
       (absolute, same height) instead of inserting above it. Inserting
       pushed every row down by the bar's height on the first click — which
       moved the row out from under the second click of a double-click. */
    <div className="relative overflow-hidden rounded-lg border border-border/70 bg-card">
      <RowsSurface locale={locale} folders={barFolders}>
      <BrowserHeader t={t} />
      <ul className="divide-y divide-border/50">
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.id}`}>
            {entry.kind === "folder" ? (
              /* A FOLDER row is no longer a link: Drive's model (Files v2 §7)
                 is single-click SELECTS, double-click OPENS — SelectableRow
                 owns both, and navigation happens client-side on the double
                 click. This is also the latency fix: a stray click used to be
                 a full page load.

                 A row is a drop target ONLY if it declares one. The old
                 fallback to "move to the top level" meant a CLIENT row on the
                 root list accepted documents and answered "moved" while
                 changing nothing — they were already at the top level. */
              <MaybeDropTarget drop={entry.dropTarget} label={entry.name}>
              <DraggableFolder moves={entry.dragPayload ?? null} name={entry.name}>
              <SelectableRow
                kind="folder"
                rowKey={entry.id}
                name={entry.name}
                href={entry.href}
                manage={entry.manage}
              >
              <div className={cn(ROW_CLASS, "gap-0 p-0")}>
              <div className={cn(ROW_CLASS, "min-w-0 flex-1")}>
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Folder
                    // Filled, in the brand blue: the single strongest signal
                    // that a row is a container rather than a document.
                    className="size-5 shrink-0 fill-accent/25 text-accent"
                    aria-hidden
                  />
                  <span className="truncate text-sm">{entry.name}</span>
                </span>
                <Cell width="w-36" column="type">{entry.hint ?? ""}</Cell>
                <Cell width="w-40" column="source">{""}</Cell>
                <Cell width="w-20" align="right" column="size">
                  {""}
                </Cell>
                <Cell width="w-24" align="right" column="modified">
                  {entry.modified ? formatDate(entry.modified, locale, "short") : ""}
                </Cell>
              </div>
                {/* Custom folders carry rename/delete here; derived folders
                    have nothing to act on, and the empty span keeps both
                    aligned with the file rows below. The menu stays OUTSIDE
                    the selectable body so its clicks stay its own. */}
                <span className="w-8 shrink-0 pr-4 text-right">
                  {entry.actions}
                </span>
              </div>
              </SelectableRow>
              </DraggableFolder>
              </MaybeDropTarget>
            ) : (
              // A FILE row is NOT wrapped in a link, even once preview exists:
              // the "From" cell holds its own link to the source engagement, and
              // an anchor inside an anchor is invalid HTML that browsers repair
              // unpredictably. The name is the click target instead — which is
              // also how Drive and Finder behave.
              <DraggableFile
                source={entry.selectSource ?? ""}
                id={entry.selectId ?? ""}
                name={entry.name}
              >
              <SelectableRow
                kind="file"
                rowKey={entry.id}
                source={entry.selectSource}
                id={entry.selectId}
                previewUrl={
                  entry.selectSource && entry.selectId
                    ? `/api/files/${entry.selectId}?source=${entry.selectSource}`
                    : undefined
                }
              >
              <MaybeRowContext meta={entry.docMeta} locale={locale}>
              <div className={ROW_CLASS}>
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {/* Renders nothing outside a selection provider (the recycle
                      bin), so the same row works in both places. */}
                  <RowCheckbox
                    source={entry.selectSource ?? ""}
                    id={entry.selectId ?? ""}
                    label={entry.name}
                  />
                  {(() => {
                    const Icon = iconForMime(entry.mimeType);
                    return (
                      <Icon
                        className="size-5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    );
                  })()}
                  {entry.href ? (
                    <Link
                      href={entry.href}
                      className="truncate text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="truncate text-sm">{entry.name}</span>
                  )}
                  {entry.badges?.map((b) => (
                    <Badge key={b.label} variant={b.tone} className="shrink-0">
                      {b.label}
                    </Badge>
                  ))}
                </span>

                <Cell width="w-36" column="type">{entry.typeLabel ?? "—"}</Cell>
                <Cell width="w-40" column="source">
                  {entry.from ? (
                    entry.from.href && !entry.from.muted ? (
                      <Link
                        href={entry.from.href}
                        className="truncate text-primary underline-offset-4 hover:underline"
                      >
                        {entry.from.label}
                      </Link>
                    ) : (
                      <span className="truncate italic">{entry.from.label}</span>
                    )
                  ) : (
                    "—"
                  )}
                </Cell>
                <Cell width="w-20" align="right" column="size">
                  {formatBytes(entry.sizeBytes)}
                </Cell>
                <Cell width="w-24" align="right" column="modified">
                  {entry.modified ? formatDate(entry.modified, locale, "short") : ""}
                </Cell>
                <span className="w-8 shrink-0 text-right">
                  {entry.actions ??
                    (entry.docMeta && (
                      <DocumentActionsMenu {...entry.docMeta} locale={locale} />
                    ))}
                </span>
              </div>
              {entry.snippet && entry.snippet.length > 0 && (
                <p className="-mt-1 truncate px-4 pb-2 pl-[3.75rem] text-xs text-muted-foreground">
                  {entry.snippet.map((part, i) =>
                    part.marked ? (
                      <mark
                        key={i}
                        className="rounded-sm bg-accent/20 px-0.5 text-foreground"
                      >
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </p>
              )}
              </MaybeRowContext>
              </SelectableRow>
              </DraggableFile>
            )}
          </li>
        ))}
      </ul>
      </RowsSurface>
    </div>
  );
}

// Shared row geometry, so the header and every row line up exactly. Drifting
// these apart is the classic way a hand-built table starts looking broken.
// py-3 + the size-5 icons below = ~52px rows, Drive's list density. The
// founder's review of the old rows: too small — "should feel like a file
// manager, not a data grid".
// The group-data override drops the gray hover wash while the row is
// SELECTED: gray at 50% over the hard selection blue muddied it into exactly
// the "too dark" look the founder rejected. (SelectableRow is the `group`.)
const ROW_CLASS =
  "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 group-data-[selected]:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// Each metadata column earns its place only once the row is wide enough to
// still show a NAME afterwards.
//
// These were all `hidden sm:block`, which meant that from 640px upward every
// column appeared at once — about 604px of fixed width before the name gets
// anything. Between roughly 640px and 900px the name flexed to ZERO and rows
// rendered as a folder icon and a date with no label at all. The text was in
// the DOM the whole time, which is why it never looked like a bug worth
// chasing; it just looked like the list was broken.
//
// Widest column drops last. Modified never drops — "which of these did we
// touch last" is the one thing the list has to answer at any size.
const COL_VISIBILITY = {
  type: "hidden lg:block",
  source: "hidden xl:block",
  size: "hidden md:block",
  modified: "block",
} as const;

/** One metadata cell. */
function Cell({
  width,
  align = "left",
  column,
  children,
}: {
  width: string;
  align?: "left" | "right";
  column: keyof typeof COL_VISIBILITY;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 truncate text-xs text-muted-foreground",
        width,
        align === "right" && "text-right",
        COL_VISIBILITY[column],
      )}
    >
      {children}
    </span>
  );
}

function BrowserHeader({ t }: { t: (key: string) => string }) {
  return (
    // Fixed h-11 — the selection strip overlays this row at the same height,
    // so the two must match exactly or rows shift when the strip appears.
    <div className="flex h-11 items-center gap-3 border-b border-border/60 bg-muted/30 px-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="min-w-0 flex-1">{t("col_name")}</span>
      <span className="hidden w-36 shrink-0 lg:block">{t("col_type")}</span>
      <span className="hidden w-40 shrink-0 xl:block">{t("col_source")}</span>
      <span className="hidden w-20 shrink-0 text-right md:block">
        {t("col_size")}
      </span>
      <span className="w-24 shrink-0 text-right">{t("col_modified")}</span>
      <span className="w-8 shrink-0" aria-hidden />
    </div>
  );
}
