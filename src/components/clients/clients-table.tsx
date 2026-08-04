"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AvatarInitials, computeInitials } from "@/components/ui/avatar-initials";
import { StatusCapsule } from "@/components/ui/status-capsule";
import { useRouter } from "@/i18n/navigation";
import {
  MoreHorizontal,
  Link2,
} from "lucide-react";
import { ClientFormDialog } from "./client-form-dialog";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import type { ClientOwner } from "./owner";
import type { Client } from "@/lib/db/clients";
import type { EngagementStatus } from "@/lib/db/engagements";
import type { EngagementType } from "@/lib/db/templates";
import type { AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

export type ClientEngagementSummary = {
  draft: number;
  sent: number;
  in_progress: number;
  complete: number;
  cancelled: number;
  total_live: number;
};

// Minimal slice of an engagement row needed to render the expanded
// drawer beneath a client. The page picks these columns out of the
// listEngagements result so the table component doesn't need the
// full row shape.
export type ClientEngagementRow = {
  id: string;
  title: string;
  type: EngagementType;
  // Unified display status (lib/attention deriveEngagementStatus) — the page
  // passes the derived value so the drawer pill matches every other surface.
  status: EngagementStatus | "ready_to_review";
  due_date: string | null;
};

// Relationships indicator (spec §3): rows with linked clients get a subtle
// link icon + count in the name cell; the one-line summary rides the native
// title tooltip. Optional so the table renders unchanged pre-migration.
export type ClientRelationshipBadge = { count: number; summary: string };

export function ClientsTable({
  clients,
  summaries,
  owners,
  currentUserId,
  locale,
  teamEnabled,
  relationships,
}: {
  clients: Client[];
  summaries: Record<string, ClientEngagementSummary>;
  owners: Record<string, ClientOwner>;
  currentUserId: string;
  locale: AppLocale;
  teamEnabled: boolean;
  relationships?: Record<string, ClientRelationshipBadge>;
}) {
  const t = useTranslations("Clients");
  // Set of expanded client ids. Multi-expand by design — comparing two
  // clients side-by-side is a real workflow at tax season.
  if (clients.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className={cn(HEADER_ROW, COL.gap)}>
        <span className={COL.name}>{t("col_name")}</span>
        <span className={COL.type}>{t("col_type")}</span>
        <span className={COL.email}>{t("col_email")}</span>
        <span className={COL.phone}>{t("col_phone")}</span>
        <span className={COL.engagements}>{t("col_engagements")}</span>
        {teamEnabled && <span className={COL.owner}>{t("col_owner")}</span>}
        <span className={COL.actions} aria-hidden />
      </div>
      {clients.map((c) => (
        <ClientRow
          key={c.id}
          client={c}
          summary={summaries[c.id]}
          relationshipBadge={relationships?.[c.id]}
          owner={c.assigned_user_id ? owners[c.assigned_user_id] : undefined}
          isYou={
            c.assigned_user_id != null && c.assigned_user_id === currentUserId
          }
          locale={locale}
          teamEnabled={teamEnabled}
        />
      ))}
    </div>
  );
}

// Column geometry lives in ONE place so the header and every row cannot drift
// apart — the classic way a hand-built table starts looking a pixel wrong in a
// spot nobody can find. Widths are the handoff's; every column has a min and
// truncates, so nothing clips mid-glyph as the window narrows.
const COL = {
  gap: "gap-3",
  name: "flex-[1_1_220px] min-w-[120px] min-w-0",
  type: "w-[92px] flex-none",
  email: "flex-[0_1_230px] w-[230px] min-w-[80px] min-w-0 truncate",
  phone: "flex-[0_1_120px] w-[120px] min-w-[70px] min-w-0 truncate",
  engagements: "flex-[0_1_130px] w-[130px] min-w-[90px] min-w-0",
  owner: "flex-[0_1_130px] w-[130px] min-w-[70px] min-w-0",
  actions: "w-6 flex-none",
} as const;

const HEADER_ROW =
  "flex h-[42px] items-center border-b border-border/60 bg-muted/50 px-5 text-[11px] font-semibold tracking-[0.06em] uppercase text-muted-foreground";


function ClientRow({
  client,
  summary,
  relationshipBadge,
  owner,
  isYou,
  locale,
  teamEnabled,
}: {
  client: Client;
  summary: ClientEngagementSummary | undefined;
  relationshipBadge: ClientRelationshipBadge | undefined;
  owner: ClientOwner | undefined;
  isYou: boolean;
  locale: AppLocale;
  teamEnabled: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const href = `/clients/${client.id}`;

  return (
    // The WHOLE ROW opens the client — there is no expander. A chevron that
    // unfolded the engagements inline duplicated the profile's own Engagements
    // tab, and made the first click on a row do something other than "show me
    // this client". The name stays a real link so middle-click and keyboard
    // still work; the row handler is for everywhere else in it.
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={() => router.push(href)}
          className={cn(
            "flex cursor-pointer items-center border-t border-border/45 px-5 py-[11px] transition-colors hover:bg-muted/55",
            COL.gap,
          )}
        >
          <span className={cn(COL.name, "flex items-center gap-[11px]")}>
            <span
              className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11.5px] font-semibold text-accent"
              aria-hidden
            >
              {initialsOf(client.display_name)}
            </span>
            <Link
              href={href}
              onClick={stop}
              className="truncate text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {client.display_name}
            </Link>
            {relationshipBadge && relationshipBadge.count > 0 && (
              <span title={relationshipBadge.summary} className="flex shrink-0">
                <Link2
                  className="size-3.5 text-muted-foreground/60"
                  aria-hidden
                />
              </span>
            )}
            {client.archived_at && (
              <StatusCapsule tone="muted" size="sm">
                {t("archived")}
              </StatusCapsule>
            )}
          </span>

          {/* Plain text, not a pill. Every client has a type, so a badge on
              every row is decoration that drowns the one capsule that means
              something — the live-work marker two columns over. */}
          <span className={cn(COL.type, "text-[12.5px] text-muted-foreground")}>
            {client.type === "individual"
              ? t("type_individual")
              : t("type_business")}
          </span>
          <span className={cn(COL.email, "text-[13px] text-muted-foreground")}>
            {client.email ?? "—"}
          </span>
          <span
            className={cn(
              COL.phone,
              "text-[13px] text-muted-foreground tabular-nums",
            )}
          >
            {client.phone ?? "—"}
          </span>
          <span className={COL.engagements}>
            <LiveWorkCell summary={summary} />
          </span>
          {teamEnabled && (
            <span className={COL.owner}>
              <OwnerCell owner={owner} isYou={isYou} />
            </span>
          )}
          <span className={cn(COL.actions, "flex justify-end")} onClick={stop}>
            <RowActions client={client} locale={locale} />
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ClientMenuItems
          client={client}
          locale={locale}
          Item={ContextMenuItem}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Initials for the row avatar — same rule as AvatarInitials, inlined because
 * this one is a flat accent-subtle circle rather than the app's photo avatar. */
function initialsOf(name: string): string {
  return computeInitials(name);
}


function LiveWorkCell({
  summary,
}: {
  summary: ClientEngagementSummary | undefined;
}) {
  const t = useTranslations("Clients");
  // ONE capsule, and only when work is actually live. The old cell picked a
  // badge from four states, so nearly every row carried one and the column
  // read as decoration; "has something on the go" is the only thing this
  // column is scanned for.
  if (summary && summary.in_progress > 0) {
    return (
      <StatusCapsule tone="accent" className="max-w-full">
        <span className="truncate">
          {t("summary_in_progress", { count: summary.in_progress })}
        </span>
      </StatusCapsule>
    );
  }
  return <span className="text-[12.5px] text-muted-foreground/60">—</span>;
}

// Owner ("belongs to") cell — the firm member who owns this client. Shows their
// avatar + name, with a "(you)" marker when it's the current user. Unassigned
// clients (no owner, or the owner was removed) show a muted placeholder.
function OwnerCell({
  owner,
  isYou,
}: {
  owner: ClientOwner | undefined;
  isYou: boolean;
}) {
  const t = useTranslations("Clients");
  if (!owner) {
    return (
      <span className="text-[12.5px] text-muted-foreground/60">
        {t("owner_unassigned")}
      </span>
    );
  }
  return (
    <Link
      href={`/settings/team/${owner.id}`}
      className="flex min-w-0 items-center gap-2 hover:underline focus-visible:underline focus-visible:outline-none"
    >
      <AvatarInitials src={owner.avatarUrl} name={owner.name} size={22} />
      <span className="truncate text-[12.5px] text-muted-foreground">
        {owner.name}
        {isYou && (
          <span className="text-muted-foreground"> {t("owner_you")}</span>
        )}
      </span>
    </Link>
  );
}

// One menu definition, rendered by BOTH surfaces: the row's "..." button and its
// right-click menu. `Item` is the only difference between them — DropdownMenuItem
// and ContextMenuItem take the same props — so the two can never drift into
// showing different actions, which is exactly what a second copy would invite.
type MenuItemComponent = React.ComponentType<{
  asChild?: boolean;
  onSelect?: (event: Event) => void;
  className?: string;
  children?: React.ReactNode;
}>;

function ClientMenuItems({
  client,
  locale,
  Item,
}: {
  client: Client;
  locale: "fr" | "en";
  Item: MenuItemComponent;
}) {
  const t = useTranslations("Clients");
  return (
    <>
      <ClientFormDialog
        mode="edit"
        locale={locale}
        client={client}
        trigger={<Item onSelect={(e) => e.preventDefault()}>{t("edit")}</Item>}
      />
      {/* One of exactly two cross-links between Clients and Files (the other
            is "View client profile" in the Files client view). Deliberately not
            more: the two surfaces answer different questions and the spec is
            explicit that Files must not grow into a second Clients page. */}
      <Item asChild>
        <Link href={`/files?client=${client.id}`}>{t("view_files")}</Link>
      </Item>
      <Item asChild>
        <Link href={`/clients/${client.id}/archive`}>
          {t("document_archive")}
        </Link>
      </Item>
      {client.archived_at ? (
        <form action={restoreClientAction}>
          <input type="hidden" name="id" value={client.id} />
          <Item asChild>
            <button type="submit" className="w-full text-left">
              {t("restore")}
            </button>
          </Item>
        </form>
      ) : (
        <form action={archiveClientAction}>
          <input type="hidden" name="id" value={client.id} />
          <Item asChild>
            <button type="submit" className="w-full text-left">
              {t("archive")}
            </button>
          </Item>
        </form>
      )}
    </>
  );
}

function RowActions({
  client,
  locale,
}: {
  client: Client;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Clients");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("row_actions")}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ClientMenuItems
          client={client}
          locale={locale}
          Item={DropdownMenuItem}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
