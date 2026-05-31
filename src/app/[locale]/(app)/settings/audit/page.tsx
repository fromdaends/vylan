import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { listClients } from "@/lib/db/clients";
import {
  listActivityForFirm,
  type FirmActivityEntry,
} from "@/lib/db/activity";
import { AuditFilters } from "@/components/settings/audit-filters";
import {
  AUDIT_ACTIONS,
  isAuditAction,
} from "@/components/settings/audit-actions";
import { formatDate } from "@/lib/format";
import { ShieldCheck } from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export const dynamic = "force-dynamic";

const ACTOR_COLOR: Record<string, string> = {
  user: "bg-primary",
  client: "bg-success",
  system: "bg-muted-foreground",
};

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client?: string; action?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Owner-only — matches the gating on the existing Data & Privacy
  // section in /settings. Staff members get a 404 rather than a 403 so
  // the page's existence isn't leaked to non-owners.
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") {
    notFound();
  }

  const sp = await searchParams;
  const clientFilter = (sp.client ?? "").trim() || "";
  const actionFilter = isAuditAction(sp.action) ? sp.action : "";

  const [clients, entries] = await Promise.all([
    listClients({ includeArchived: true }),
    listActivityForFirm({
      clientId: clientFilter || null,
      action: actionFilter || null,
      limit: 500,
    }),
  ]);

  const t = await getTranslations("Audit");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");
  // A new `action` value can land in activity_log before the i18n is
  // updated. Only translate codes we know about; fall back to the raw
  // string (still useful for the audit trail) for anything new.
  const knownActions = new Set<string>(AUDIT_ACTIONS as readonly string[]);
  const tAction = (key: string): string =>
    knownActions.has(key)
      ? t(`action_${key}` as Parameters<typeof t>[0])
      : key;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: t("title") },
        ]}
      />

      <header className="flex flex-wrap items-end justify-between gap-4 animate-in-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
      </header>

      <AuditFilters
        clients={clients.map((c) => ({
          id: c.id,
          display_name: c.display_name,
        }))}
        client={clientFilter}
        action={actionFilter}
      />

      <div className="rounded-xl border border-border bg-card overflow-hidden animate-in-up">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <ShieldCheck className="h-6 w-6 opacity-50" aria-hidden />
            <p className="text-sm">
              {clientFilter || actionFilter ? t("empty_filtered") : t("empty")}
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {entries.map((e) => (
              <AuditRow
                key={e.id}
                entry={e}
                locale={locale}
                tAction={tAction}
                tActor={t}
              />
            ))}
          </ol>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("retention_note", { count: entries.length })}
      </p>
    </div>
  );
}

function AuditRow({
  entry,
  locale,
  tAction,
  tActor,
}: {
  entry: FirmActivityEntry;
  locale: "fr" | "en";
  tAction: (key: string) => string;
  tActor: Awaited<ReturnType<typeof getTranslations<"Audit">>>;
}) {
  const dot = ACTOR_COLOR[entry.actor_type] ?? "bg-muted-foreground";
  const actorLabel =
    entry.actor_type === "user"
      ? entry.actor_name ?? tActor("actor_user_unknown")
      : entry.actor_type === "client"
        ? entry.client_display_name ?? tActor("actor_client_unknown")
        : tActor("actor_system");
  const when = new Date(entry.created_at);
  const timeStr = new Intl.DateTimeFormat(
    locale === "fr" ? "fr-CA" : "en-CA",
    { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  ).format(when);
  const dateStr = formatDate(entry.created_at, locale, "medium");

  const body = (
    <div className="flex items-start gap-3 py-3.5 px-5 group">
      <span
        className={"mt-1.5 size-1.5 rounded-full shrink-0 " + dot}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-snug">
          <span className="font-medium">{actorLabel}</span>
          <span className="text-muted-foreground"> · </span>
          <span>{tAction(entry.action)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono tabular-nums">
          <span>{dateStr}</span>
          <span aria-hidden>·</span>
          <span>{timeStr}</span>
          {entry.client_display_name && (
            <>
              <span aria-hidden>·</span>
              <span className="font-sans">{entry.client_display_name}</span>
            </>
          )}
          {entry.engagement_title && (
            <>
              <span aria-hidden>·</span>
              <span className="font-sans truncate max-w-[20rem]">
                {entry.engagement_title}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (entry.engagement_id) {
    return (
      <li>
        <Link
          href={`/engagements/${entry.engagement_id}`}
          className="block hover:bg-secondary/40 transition-colors"
        >
          {body}
        </Link>
      </li>
    );
  }
  return <li>{body}</li>;
}

