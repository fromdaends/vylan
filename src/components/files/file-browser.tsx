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
      /** The per-file actions menu, built by the page (it is a client island). */
      actions?: React.ReactNode;
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

export async function FileBrowser({
  entries,
  locale,
  emptyMessage,
}: {
  entries: BrowserEntry[];
  locale: AppLocale;
  emptyMessage: string;
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
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <BrowserHeader t={t} />
      <ul className="divide-y divide-border/50">
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.id}`}>
            {entry.kind === "folder" ? (
              // A FOLDER is pure navigation, so the whole row is the target —
              // the big click area you expect in a file manager.
              <Link href={entry.href} className={cn(ROW_CLASS, "cursor-pointer")}>
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Folder
                    // Filled, in the brand blue: the single strongest signal
                    // that a row is a container rather than a document.
                    className="size-[18px] shrink-0 fill-accent/25 text-accent"
                    aria-hidden
                  />
                  <span className="truncate text-sm">{entry.name}</span>
                </span>
                <Cell width="w-36">{entry.hint ?? ""}</Cell>
                <Cell width="w-40">{""}</Cell>
                <Cell width="w-20" align="right">
                  {""}
                </Cell>
                <Cell width="w-24" align="right" alwaysVisible>
                  {entry.modified ? formatDate(entry.modified, locale, "short") : ""}
                </Cell>
                {/* Keeps folder rows aligned with file rows, which carry an
                    actions menu in this column. */}
                <span className="w-8 shrink-0" aria-hidden />
              </Link>
            ) : (
              // A FILE row is NOT wrapped in a link, even once preview exists:
              // the "From" cell holds its own link to the source engagement, and
              // an anchor inside an anchor is invalid HTML that browsers repair
              // unpredictably. The name is the click target instead — which is
              // also how Drive and Finder behave.
              <div className={ROW_CLASS}>
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {(() => {
                    const Icon = iconForMime(entry.mimeType);
                    return (
                      <Icon
                        className="size-[18px] shrink-0 text-muted-foreground"
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

                <Cell width="w-36">{entry.typeLabel ?? "—"}</Cell>
                <Cell width="w-40">
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
                <Cell width="w-20" align="right">
                  {formatBytes(entry.sizeBytes)}
                </Cell>
                <Cell width="w-24" align="right" alwaysVisible>
                  {entry.modified ? formatDate(entry.modified, locale, "short") : ""}
                </Cell>
                <span className="w-8 shrink-0 text-right">{entry.actions}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Shared row geometry, so the header and every row line up exactly. Drifting
// these apart is the classic way a hand-built table starts looking broken.
const ROW_CLASS =
  "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** One metadata cell. Hidden below `sm` unless it is the Modified column —
 * on a phone there is only room for the name and one date. */
function Cell({
  width,
  align = "left",
  alwaysVisible = false,
  children,
}: {
  width: string;
  align?: "left" | "right";
  alwaysVisible?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 truncate text-xs text-muted-foreground",
        width,
        align === "right" && "text-right",
        alwaysVisible ? "block" : "hidden sm:block",
      )}
    >
      {children}
    </span>
  );
}

function BrowserHeader({ t }: { t: (key: string) => string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="min-w-0 flex-1">{t("col_name")}</span>
      <span className="hidden w-36 shrink-0 sm:block">{t("col_type")}</span>
      <span className="hidden w-40 shrink-0 sm:block">{t("col_source")}</span>
      <span className="hidden w-20 shrink-0 text-right sm:block">
        {t("col_size")}
      </span>
      <span className="w-24 shrink-0 text-right">{t("col_modified")}</span>
      <span className="w-8 shrink-0" aria-hidden />
    </div>
  );
}
