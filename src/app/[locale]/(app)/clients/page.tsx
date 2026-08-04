import { getTranslations, setRequestLocale } from "next-intl/server";
import { listClients, type Client } from "@/lib/db/clients";
import { listLiveRelationshipsForFirm } from "@/lib/db/relationships";
import { resolveRelationshipRows } from "@/lib/relationships/validate";
import { listEngagements } from "@/lib/db/engagements";
import { loadEngagementSignals } from "@/lib/dashboard/worklist";
import { deriveEngagementStatus } from "@/lib/attention";

// Real-time data: never serve a cached version after Mark complete /
// archive / etc.
export const dynamic = "force-dynamic";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ClientsListView } from "@/components/clients/clients-list-view";
import { SORT_OPTIONS, type SortKey } from "@/components/clients/sort";
import {
  filterClientsByOwner,
  type ClientOwner,
} from "@/components/clients/owner";
import { DemoBlockButton } from "@/components/app/demo-block-modal";
import { getCurrentFirm } from "@/lib/db/firms";
import { isTrialExpired } from "@/lib/trial";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { getBrandingImageUrl } from "@/lib/storage";
import { buildClientEngagementIndex } from "@/lib/clients/engagement-index";
import type { ClientEngagementSummary } from "@/components/clients/clients-table";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { assertLocale } from "@/lib/locale";
import { Upload } from "lucide-react";
import { hasActiveTeam } from "@/lib/team/mode";

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  // `q` was a server-side filter parameter; the search is now an
  // instant client-side filter held inside <ClientsListView>, so the
  // server doesn't read it anymore. The URL param is intentionally
  // dropped — no point keeping a stale URL parameter the page no
  // longer honors. Other filters (type / sort / active / archived)
  // remain URL-driven.
  searchParams: Promise<{
    type?: string;
    archived?: string;
    sort?: string;
    active?: string;
    owner?: string;
  }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const type =
    sp.type === "individual" || sp.type === "business" ? sp.type : "all";
  const includeArchived = sp.archived === "1";
  const sort: SortKey = SORT_OPTIONS.includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : "recent";
  const activeOnly = sp.active === "1";

  // ONE clients query for the whole page: the relationships name map below
  // needs every client (archived included), and the table's type/archived view
  // is a pure subset of that — so fetch the superset once and filter in
  // memory, instead of the two overlapping table scans this page used to run.
  // listEngagements() here and the one inside loadEngagementSignals("active")
  // are the identical query — the request-level cache in lib/db/engagements
  // collapses them to one.
  const [allClients, engagements, firm, currentUser, members, signals] =
    await Promise.all([
      listClients({ includeArchived: true }),
      listEngagements(),
      getCurrentFirm(),
      getCurrentUser(),
      listFirmUsers(),
      // Unified status for the drawer pills: the same cached signal load the
      // Overview uses, so a "Ready to review" engagement reads ready here too.
      loadEngagementSignals("active"),
    ]);
  const clientsRaw = allClients.filter(
    (c) =>
      (includeArchived || !c.archived_at) && (type === "all" || c.type === type),
  );
  const derivedStatusById = new Map(
    signals.map((s) => [
      s.engagement.id,
      deriveEngagementStatus(s.engagement.status, s.attention),
    ]),
  );
  // Write actions are locked only once the free trial has expired; an active
  // trial has full access.
  const trialLocked = firm ? isTrialExpired(firm) : false;
  // clients.manage — carried by the member preset, so this hides nothing for
  // anyone today. It only bites once an owner makes someone a Junior, which is
  // the point: a Junior works ON clients without adding or importing them.
  const canManageClients = can(currentUser, "clients.manage");
  const currentUserId = currentUser?.id ?? "";
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm?.team_enabled === true,
    activeMemberCount: members.filter((m) => !m.deactivated_at).length,
  });

  // Default to YOUR OWN clients in team mode — /clients opens on your book and
  // one click widens it to the whole firm. There is deliberately no third
  // option for "a teammate's clients": that was a filter doing navigation's
  // job, reachable by ?owner=<id> from the team page, and it left this page
  // titled "Clients" while showing somebody else's book with nothing saying so.
  // A teammate's clients are a question about the teammate, and they are
  // answered on their profile (/settings/team/<id>). Non-team firms stay "all".
  const ownerFilter: string = teamEnabled
    ? currentUserId
      ? "mine"
      : "all"
    : "all";

  // Resolve each firm member's avatar once (small set — seat caps are 1–15)
  // so the table can render an owner badge without N per-row fetches.
  const memberAvatars = await Promise.all(
    members.map((m) => getBrandingImageUrl(m.avatar_path)),
  );
  const owners: Record<string, ClientOwner> = {};
  members.forEach((m, i) => {
    owners[m.id] = {
      id: m.id,
      name: userDisplayLabel(m),
      avatarUrl: memberAvatars[i],
    };
  });

  // Everything the table needs to know about engagements, in one pass: the
  // per-client status tallies behind the row badge, the rows the expanded
  // drawer lists (so opening one costs no fetch), and the newest timestamp the
  // `most_active` sort reads. Shared with the teammate profile's Clients tab —
  // it renders the same table, so it must count the same way.
  const { summaries, engagementsByClient, lastActivityByClient } =
    buildClientEngagementIndex(engagements, derivedStatusById);

  // Apply the "Active only" filter — only clients with at least one
  // engagement in sent / in_progress (= total_live > 0).
  let clients: Client[] = clientsRaw;
  if (activeOnly) {
    clients = clients.filter((c) => (summaries[c.id]?.total_live ?? 0) > 0);
  }
  // Apply the "My clients / All firm" owner filter.
  if (teamEnabled) {
    clients = filterClientsByOwner(clients, ownerFilter, currentUserId);
  }

  // Apply sort. listClients already returns newest-first, so `recent`
  // is a no-op pass-through.
  clients = sortClients(
    clients,
    sort,
    summaries,
    lastActivityByClient,
    locale,
  );

  const t = await getTranslations("Clients");

  // Relationships indicator (spec §3): one query for the firm's live links;
  // the name map reuses the superset fetched above (archived included so a
  // link to an archived client still reads as a name, and unaffected by this
  // page's type filter). Turned into a per-client {count, one-line summary}
  // map for the row badge + tooltip.
  const firmRelationships = await listLiveRelationshipsForFirm();
  const relNameById = new Map(
    allClients.map((c) => [c.id, c.display_name]),
  );
  const relScopeSummary = (scopes: readonly string[] | null) =>
    (scopes ?? []).map((s) => t(`rel_scope_${s}`)).join(", ");
  const relationshipBadges: Record<
    string,
    { count: number; summary: string }
  > = {};
  for (const c of clientsRaw) {
    const rows = resolveRelationshipRows(c.id, firmRelationships).filter((r) =>
      relNameById.has(r.otherClientId),
    );
    if (rows.length === 0) continue;
    const parts = rows.slice(0, 3).map((r) => {
      const name = relNameById.get(r.otherClientId)!;
      const label =
        r.relType === "spouse_of"
          ? t("rel_spouse")
          : r.relType === "owner_of"
            ? r.direction === "out"
              ? t("rel_owns", { pct: r.percentage ?? 0 })
              : t("rel_owner", { pct: r.percentage ?? 0 })
            : t("rel_contact", { scopes: relScopeSummary(r.scopes) });
      return `${label} · ${name}`;
    });
    const extra = rows.length - parts.length;
    relationshipBadges[c.id] = {
      count: rows.length,
      summary:
        extra > 0 ? `${parts.join("; ")} +${extra}` : parts.join("; "),
    };
  }

  // The header lives INSIDE ClientsListView: its search box drives the live
  // client-side filter, so it has to sit next to that state rather than in a
  // Server Component above it. These buttons are still rendered here (they need
  // the firm, the trial state and the teammate list) and passed straight in.
  const headerActions = (
    <>
          {!canManageClients ? null : trialLocked ? (
            <>
              <DemoBlockButton
                label={t("import_csv")}
                icon={<Upload className="h-4 w-4" />}
                reasonKey="block_import_csv_reason"
                variant="ghost"
                size="sm"
              />
              <DemoBlockButton
                label={t("add_client")}
                icon={<Upload className="h-4 w-4 hidden" />}
                reasonKey="block_add_client_reason"
                size="sm"
              />
            </>
          ) : (
            <>
              <Link href="/clients/import">
                <Button
                  variant="ghost"
                  className="h-[42px] gap-[7px] rounded-[10px] px-3.5 text-sm font-medium text-muted-foreground"
                >
                  <Upload className="h-4 w-4" />
                  {t("import_csv")}
                </Button>
              </Link>
              <ClientFormDialog
                mode="create"
                locale={locale}
                teammates={
                  teamEnabled
                    ? members
                        .filter(
                          (m) => !m.deactivated_at && m.id !== currentUser?.id,
                        )
                        .map((m) => ({ id: m.id, name: userDisplayLabel(m) }))
                    : []
                }
              />
            </>
          )}
    </>
  );

  return (
    <div className="w-full animate-in-fade px-6 pt-7 pb-18 lg:px-11">
      <ClientsListView
        title={t("title")}
        subtitle={t("count", { count: clients.length })}
        actions={headerActions}
        clients={clients}
        summaries={summaries}
        owners={owners}
        currentUserId={currentUserId}
        ownerFilter={ownerFilter}
        locale={locale}
        type={type}
        includeArchived={includeArchived}
        sort={sort}
        activeOnly={activeOnly}
        teamEnabled={teamEnabled}
        relationships={relationshipBadges}
      />
    </div>
  );
}

function sortClients(
  clients: Client[],
  sort: SortKey,
  summaries: Record<string, ClientEngagementSummary>,
  lastActivityByClient: Record<string, string>,
  locale: "fr" | "en",
): Client[] {
  // localeCompare gives us a sensible alphabetical order for French
  // accents (Étienne vs Etienne) without rebuilding the strings.
  const collator = new Intl.Collator(locale === "fr" ? "fr-CA" : "en-CA", {
    sensitivity: "base",
  });
  const out = [...clients];
  switch (sort) {
    case "recent":
      // listClients already sorts by created_at desc — keep as-is.
      break;
    case "oldest":
      out.sort((a, b) => a.created_at.localeCompare(b.created_at));
      break;
    case "name_asc":
      out.sort((a, b) => collator.compare(a.display_name, b.display_name));
      break;
    case "name_desc":
      out.sort((a, b) => collator.compare(b.display_name, a.display_name));
      break;
    case "most_engagements": {
      // Sum all statuses (not just live) so a client with 5 completed
      // engagements out-ranks one with 1 active. Tie-breaker: newest
      // client first so freshly-imported tied clients bubble up.
      const total = (id: string) => {
        const s = summaries[id];
        if (!s) return 0;
        return s.draft + s.sent + s.in_progress + s.complete + s.cancelled;
      };
      out.sort((a, b) => {
        const d = total(b.id) - total(a.id);
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
      break;
    }
    case "most_active": {
      // Newest engagement activity wins. Clients with no engagements at
      // all sink to the bottom (treated as epoch).
      const ts = (id: string) => lastActivityByClient[id] ?? "";
      out.sort((a, b) => {
        const d = ts(b.id).localeCompare(ts(a.id));
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
      break;
    }
  }
  return out;
}
