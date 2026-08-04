import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  ArrowRight,
  Folder,
  Sparkles,
} from "lucide-react";
import { StatusCapsule } from "@/components/ui/status-capsule";
import { computeInitials } from "@/components/ui/avatar-initials";
import { formatDate, formatRelative, type AppLocale } from "@/lib/format";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import { listDocuments, type BrowseDocument } from "@/lib/db/documents";
import { listActivityForFirm, type FirmActivityEntry } from "@/lib/db/activity";
import { openSuggestionCounts } from "@/lib/files/organize";
import { ScanNowButton } from "@/components/files/organize-review";
import { DocumentRowContextMenu } from "@/components/files/document-actions-menu";
import { docMenuMeta } from "@/lib/files/doc-menu-meta";
import { UploadDropzone } from "@/components/files/upload-dropzone";
import { ProviderLogo } from "@/components/filing/provider-logos";
import { getFirmStorageConnection } from "@/lib/db/filing";
import { listClientOptions } from "@/lib/db/clients";
import { getServerSupabase } from "@/lib/supabase/server";
import { isAuditAction } from "@/components/settings/audit-actions";

// FILES HOME — the landing view for the firm's documents.
//
// A MAIN COLUMN and a SIDE RAIL, not a stack of full-width boxes: the things
// you read (what arrived, what the AI wants to file) get the width, and the
// things you act on or glance at (drop files, where filing goes, who did what)
// sit beside them. On a narrow window the rail wraps underneath, which is why
// this is flex-wrap and not a two-column grid.
//
// There is deliberately NO stats bar. Four counters — total documents, this
// month, pending, storage — is a dashboard about documents rather than a way
// into them, and none of the four is a number anyone acts on. Removing it also
// removed two head-count queries from every load of this page.
//
// FOUR flat queries, run in parallel: one page of documents, one activity
// read, one storage-connection read, one suggestion count (plus the client
// list the dropzone needs). No N+1, nothing proportional to firm size.

/** The audit-log actions that count as "file activity" for the Home feed. */
const FILE_ACTIVITY_ACTIONS = [
  "file_renamed",
  "file_moved",
  "file_downloaded",
  "file_deleted",
  "file_restored",
  "file_visibility_changed",
  "documents_imported",
  "bulk_download",
  "folder_created",
  "folder_renamed",
  "folder_moved",
  "folder_deleted",
];

export async function HomeTab({ locale }: { locale: AppLocale }) {
  const t = await getTranslations("Files");
  const tAudit = await getTranslations("Audit");

  const [docsPage, activity, storage, organize, clients] = await Promise.all([
    listDocuments({ sort: "date", page: 1 }),
    listActivityForFirm({ actions: FILE_ACTIVITY_ACTIONS, limit: 15 }),
    getFirmStorageConnection(),
    openSuggestionCounts(),
    listClientOptions(),
  ]);

  const recent = docsPage.documents.slice(0, 10);

  // Client names for the recent rows — one query for the page's clients, the
  // same pattern FileList uses for firm-wide results.
  let clientNames = new Map<string, string>();
  if (recent.length > 0) {
    const sb = await getServerSupabase();
    const ids = [...new Set(recent.map((d) => d.clientId))];
    const { data } = await sb.from("clients").select("id, display_name").in("id", ids);
    clientNames = new Map(
      ((data ?? []) as Array<{ id: string; display_name: string }>).map((c) => [
        c.id,
        c.display_name,
      ]),
    );
  }

  return (
    // ONE FIXED PAGE at desktop width: the row is sized to the viewport
    // (100dvh minus the page chrome above it — heading, tab strip, paddings),
    // both columns stretch to that same bottom edge, and the two lists inside
    // (Team activity, Recent files) scroll internally instead of pushing the
    // page longer. The min-h floor keeps a short window from crushing the rail
    // cards — below it the page scrolls, which beats clipped controls.
    // Under lg the columns wrap into a stack and the page scrolls normally.
    // gap-6 between cards — the site-wide rhythm (dashboard, client page and
    // Work all separate cards by 24px), not a Files-only value.
    <div className="flex flex-wrap items-start gap-6 lg:h-[calc(100dvh-200px)] lg:min-h-[520px] lg:flex-nowrap lg:items-stretch">
      {/* SIDE RAIL, on the LEFT. The things you DO — drop files in, check that
          filing is still connected, see who touched what — sit against the
          navigation edge; the things you READ get the open width to their
          right. Rail first in the DOM as well as on screen, so keyboard and
          screen-reader order match what you see. */}
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-6 lg:min-h-0 lg:max-w-[300px]">
        <UploadDropzone clients={clients} />
        <CloudFiling t={t} storage={storage} />
        <TeamActivity
          t={t}
          tAudit={tAudit}
          locale={locale}
          entries={activity}
        />
      </div>

      {/* MAIN COLUMN. flex-999 makes it take essentially all the spare width
          while still being allowed to wrap; 560px is the basis below which it
          drops under the rail rather than squeezing the file names. */}
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 lg:min-h-0">
        {organize.available && <OrganizeBar t={t} total={organize.total} />}
        <RecentFiles
          t={t}
          locale={locale}
          recent={recent}
          clientNames={clientNames}
        />
      </div>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Files">>>;
type TAudit = Awaited<ReturnType<typeof getTranslations<"Audit">>>;

/** One card. The kit's rule: one card per subject, hairline rows inside it,
 * whitespace between subjects — never a box inside a box. */
const CARD = "rounded-xl border border-border/70 bg-card";

// ── AI Organize ─────────────────────────────────────────────────────────────
// A single bar rather than a card: it is a prompt to act, and it should read as
// one line of the page rather than a section competing with the file list. It
// only appears once the Organize schema exists — an empty promise card would be
// worse than its absence.

function OrganizeBar({ t, total }: { t: T; total: number }) {
  return (
    <section className={`${CARD} flex shrink-0 items-center justify-between gap-4 px-5 py-3.5`}>
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-subtle text-accent">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("organize_title")}</h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {total > 0 ? t("organize_ready", { count: total }) : t("organize_all_clear")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ScanNowButton />
        {total > 0 && (
          <Link
            href="/files/organize"
            className="inline-flex h-[34px] items-center rounded-lg border border-border bg-card px-3.5 text-[13.5px] font-medium transition-colors hover:border-accent hover:text-accent"
          >
            {t("organize_review")} {total}
          </Link>
        )}
      </div>
    </section>
  );
}

// ── Recent files ────────────────────────────────────────────────────────────

/** The document's spot in Browse. A filed document lives in its folder — its
 * derived year/category view no longer lists it, so the folder link is the
 * only one that actually shows the file when clicked. */
function docHref(d: BrowseDocument): string {
  if (d.folderId) return `/files?client=${d.clientId}&folder=${d.folderId}`;
  const year = d.year != null ? String(d.year) : "unsorted";
  const category = d.category ?? "unsorted";
  return `/files?client=${d.clientId}&year=${year}&category=${category}`;
}

function RecentFiles({
  t,
  locale,
  recent,
  clientNames,
}: {
  t: T;
  locale: AppLocale;
  recent: BrowseDocument[];
  clientNames: Map<string, string>;
}) {
  const sourceLabel = (d: BrowseDocument) =>
    d.source === "imported"
      ? t("badge_imported")
      : d.source === "final"
        ? t("home_source_engagement")
        : t("home_source_portal");

  return (
    // flex-1 + internal scroll: on the fixed Home page this card grows to the
    // row's bottom edge (aligning with the rail) and its list scrolls inside
    // rather than lengthening the page.
    <section className={`${CARD} flex flex-col overflow-hidden lg:min-h-0 lg:flex-1`}>
      <div className="flex h-13 shrink-0 items-center justify-between px-5">
        <h2 className="text-[14.5px] font-semibold">{t("home_recent_title")}</h2>
        <Link
          href="/files?tab=browse&view=files&sort=date"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
        >
          {t("home_view_all")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="border-t border-border/50 px-5 py-10 text-center text-sm text-muted-foreground">
          {t("home_recent_empty")}
        </p>
      ) : (
        <ul className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {recent.map((d) => (
            <li key={`${d.source}-${d.id}`}>
              {/* Right-click gets the SAME menu as a row in Browse — rename,
                  move, visibility, delete. A row that looks like a file row
                  and answers a right-click with the browser's own menu reads
                  as "this one isn't really a file", so both surfaces share one
                  menu and one identity builder. */}
              <DocumentRowContextMenu {...docMenuMeta(d)} locale={locale}>
              {/* The plain div is the ContextMenuTrigger's `asChild` target.
                  Radix clones its handlers onto whatever child it is given,
                  and handing it the Link directly renders an EMPTY row — the
                  same reason FileBrowser wraps its rows this way. */}
              <div>
              <Link
                href={docHref(d)}
                className="flex items-center gap-3 border-t border-border/50 px-5 py-[11px] transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <DocIcon />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{d.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {clientNames.get(d.clientId) ?? "—"} · {sourceLabel(d)}
                  </span>
                </span>
                {/* Color marks the EXCEPTION: only a document still waiting on
                    a human gets a capsule. Approved is the resting state and
                    says nothing. */}
                {d.reviewStatus === "pending" && (
                  <StatusCapsule tone="warning" className="hidden sm:inline-flex">
                    {t("status_pending")}
                  </StatusCapsule>
                )}
                {/* Doc type as PLAIN TEXT, not a badge — every row has one, so
                    a badge on each is decoration that makes the one real
                    status capsule above impossible to spot. */}
                <span className="hidden min-w-0 flex-[0_1_180px] truncate text-[12.5px] text-muted-foreground lg:block">
                  {d.docType ? DOC_TYPE_LABELS[d.docType][locale].split(" — ")[0] : ""}
                </span>
                <span className="w-13 shrink-0 text-right text-[12.5px] text-muted-foreground">
                  {formatDate(d.createdAt, locale, "compact")}
                </span>
              </Link>
              </div>
              </DocumentRowContextMenu>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The file glyph on a recent row. Thin stroke on purpose — at 20px a 2px
 * stroke reads as a filled block and fights the file name beside it. */
function DocIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

// ── Cloud filing ────────────────────────────────────────────────────────────
// Where approved documents end up. On the rail rather than in the main column
// because it is a status you check, not a list you read — and it is the one
// place on Home that links into Filing settings.

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
  microsoft: "OneDrive",
  onedrive: "OneDrive",
  smartvault: "SmartVault",
};

function CloudFiling({
  t,
  storage,
}: {
  t: T;
  storage: Awaited<ReturnType<typeof getFirmStorageConnection>>;
}) {
  const connected = storage != null && storage.status === "active";
  const providerLabel = storage
    ? (PROVIDER_LABELS[storage.provider] ?? storage.provider)
    : null;

  return (
    <section className={`${CARD} shrink-0 px-5 py-4.5`}>
      <div className="flex items-center gap-2.5">
        {storage ? (
          <ProviderLogo provider={storage.provider} className="size-5.5 shrink-0" />
        ) : (
          <Folder className="size-5.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <h2 className="flex-1 text-sm font-semibold">{t("home_cloud_title")}</h2>
        {storage && (
          <StatusCapsule tone={connected ? "success" : "destructive"}>
            {connected ? t("status_connected") : t("home_glance_storage_error")}
          </StatusCapsule>
        )}
      </div>

      <p className="mt-2.5 text-[13px] leading-[1.55] text-muted-foreground">
        {providerLabel
          ? t("home_cloud_body", { provider: providerLabel })
          : t("home_cloud_body_off")}
      </p>

      {storage && (
        <p className="mt-3 flex items-center gap-2 text-[13px]">
          <Folder className="size-3.75 shrink-0 text-icon-amber" aria-hidden />
          <span className="truncate">
            {providerLabel}
            {storage.rootLabel ? ` › ${storage.rootLabel}` : ""}
          </span>
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-4">
        <Link
          href="/files?tab=settings"
          className="text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
        >
          {storage ? t("home_cloud_settings") : t("home_cloud_connect")} →
        </Link>
      </div>
    </section>
  );
}

// ── Team activity ───────────────────────────────────────────────────────────

function TeamActivity({
  t,
  tAudit,
  locale,
  entries,
}: {
  t: T;
  tAudit: TAudit;
  locale: AppLocale;
  entries: FirmActivityEntry[];
}) {
  return (
    // The rail's flexible card: it takes whatever height is left under the
    // dropzone and Cloud filing, ends level with the Recent files card, and
    // the feed scrolls inside it. This is what used to make the rail run past
    // the main column — the feed's length now never sets the page's length.
    <section className={`${CARD} flex flex-col overflow-hidden lg:min-h-0 lg:flex-1`}>
      <div className="flex h-12 shrink-0 items-center justify-between px-4.5">
        <h2 className="text-sm font-semibold">{t("home_activity_title")}</h2>
        <Link
          href="/settings/audit"
          className="text-[12.5px] font-medium text-accent transition-colors hover:text-accent-hover"
        >
          {t("home_activity_audit")} →
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="px-4.5 pb-8 text-center text-sm text-muted-foreground">
          {t("home_activity_empty")}
        </p>
      ) : (
        // All fetched entries render (the query caps at 15): the card clips to
        // its share of the rail and scrolls, so a longer feed costs nothing —
        // the old slice(0, 8) existed only to keep the unclipped card short.
        <ul className="pb-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {entries.map((e) => {
            // Registered actions render their localized label; anything else
            // falls back to the raw code rather than crashing the page — the
            // audit view applies the same rule.
            const actionLabel = isAuditAction(e.action)
              ? tAudit(`action_${e.action}` as Parameters<typeof tAudit>[0])
              : e.action;
            const count =
              typeof e.metadata?.count === "number" ? e.metadata.count : null;
            const who = e.actor_name ?? t("home_activity_system");
            return (
              <li key={e.id} className="flex items-start gap-2.5 px-4.5 py-2">
                <span
                  className="mt-px inline-flex size-6.5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[10.5px] font-semibold text-accent"
                  aria-hidden
                >
                  {computeInitials(who)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[1.45]">
                    <span className="font-semibold">{who}</span>{" "}
                    <span className="text-muted-foreground">
                      {actionLabel}
                      {count != null && count > 1 ? ` (${count})` : ""}
                    </span>
                  </span>
                  {e.client_display_name && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.client_display_name}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 shrink-0 text-[11.5px] text-muted-foreground">
                  {formatRelative(e.created_at, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
