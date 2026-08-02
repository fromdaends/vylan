import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  Cloud,
  FileText,
  Files,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate, type AppLocale } from "@/lib/format";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import {
  countDocumentsSince,
  countPendingAnalysis,
  listDocuments,
  type BrowseDocument,
} from "@/lib/db/documents";
import { listActivityForFirm, type FirmActivityEntry } from "@/lib/db/activity";
import { getFirmStorageConnection } from "@/lib/db/filing";
import { getServerSupabase } from "@/lib/supabase/server";
import { isAuditAction } from "@/components/settings/audit-actions";

// FILES HOME — the landing dashboard for the firm's documents.
//
// Four sections, per the v2 spec, and nothing else: recent files, team
// activity, AI Organize (arrives with the Organize scanner — nothing renders
// until it exists, an empty promise card would be worse than absence), and an
// at-a-glance stat row.
//
// The whole tab is FIVE flat queries, run in parallel: one page of documents
// (whose exact count doubles as the "total documents" stat), one activity
// read, one storage-connection read, and two head-counts that never fetch
// rows. No N+1, nothing proportional to firm size.

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

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [docsPage, activity, storage, monthCount, pendingCount] =
    await Promise.all([
      listDocuments({ sort: "date", page: 1 }),
      listActivityForFirm({ actions: FILE_ACTIVITY_ACTIONS, limit: 15 }),
      getFirmStorageConnection(),
      countDocumentsSince(monthStart.toISOString()),
      countPendingAnalysis(),
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
    <div className="space-y-6">
      <AtAGlance
        t={t}
        total={docsPage.total}
        month={monthCount}
        pending={pendingCount}
        storage={storage}
      />
      <RecentFiles t={t} locale={locale} recent={recent} clientNames={clientNames} />
      <TeamActivity t={t} tAudit={tAudit} locale={locale} entries={activity} />
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Files">>>;
type TAudit = Awaited<ReturnType<typeof getTranslations<"Audit">>>;

// ── At a glance ─────────────────────────────────────────────────────────────

function AtAGlance({
  t,
  total,
  month,
  pending,
  storage,
}: {
  t: T;
  total: number;
  month: number;
  pending: number;
  storage: Awaited<ReturnType<typeof getFirmStorageConnection>>;
}) {
  const storageValue =
    storage == null || storage.status === "disconnected"
      ? t("home_glance_storage_off")
      : storage.status === "error"
        ? t("home_glance_storage_error")
        : t("home_glance_storage_on", { provider: PROVIDER_LABELS[storage.provider] ?? storage.provider });

  const stats: { icon: React.ReactNode; label: string; value: string }[] = [
    {
      icon: <Files className="size-4" aria-hidden />,
      label: t("home_glance_total"),
      value: String(total),
    },
    {
      icon: <CalendarDays className="size-4" aria-hidden />,
      label: t("home_glance_month"),
      value: String(month),
    },
    {
      icon: <Cloud className="size-4" aria-hidden />,
      label: t("home_glance_storage"),
      value: storageValue,
    },
    {
      icon: <Bot className="size-4" aria-hidden />,
      label: t("home_glance_pending"),
      value: String(pending),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-border/70 bg-card px-4 py-3"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {s.icon}
            {s.label}
          </div>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight">
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
  microsoft: "OneDrive",
  onedrive: "OneDrive",
  smartvault: "SmartVault",
};

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
    <section className="rounded-lg border border-border/70 bg-card">
      <SectionHeader
        icon={<FileText className="size-4" aria-hidden />}
        title={t("home_recent_title")}
        link={{ href: "/files?sort=date", label: t("home_view_all") }}
      />
      {recent.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {t("home_recent_empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {recent.map((d) => (
            <li key={`${d.source}-${d.id}`}>
              <Link
                href={docHref(d)}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{d.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {clientNames.get(d.clientId) ?? "—"}
                  </span>
                </span>
                {d.docType && (
                  <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                    {DOC_TYPE_LABELS[d.docType][locale].split(" — ")[0]}
                  </Badge>
                )}
                <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                  {sourceLabel(d)}
                </span>
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                  {formatDate(d.createdAt, locale, "short")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
    <section className="rounded-lg border border-border/70 bg-card">
      <SectionHeader
        icon={<Activity className="size-4" aria-hidden />}
        title={t("home_activity_title")}
        link={{ href: "/settings/audit", label: t("home_activity_audit") }}
      />
      {entries.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {t("home_activity_empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {entries.map((e) => {
            // Registered actions render their localized label; anything else
            // falls back to the raw code rather than crashing the page — the
            // audit view applies the same rule.
            const actionLabel = isAuditAction(e.action)
              ? tAudit(`action_${e.action}` as Parameters<typeof tAudit>[0])
              : e.action;
            const count =
              typeof e.metadata?.count === "number" ? e.metadata.count : null;
            return (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    <span className="font-medium">
                      {e.actor_name ?? t("home_activity_system")}
                    </span>{" "}
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
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                  {formatDate(e.created_at, locale, "short")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SectionHeader({
  icon,
  title,
  link,
}: {
  icon: React.ReactNode;
  title: string;
  link: { href: string; label: string };
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </h2>
      <Link
        href={link.href}
        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
      >
        {link.label}
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}
