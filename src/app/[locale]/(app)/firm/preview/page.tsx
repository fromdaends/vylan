import { redirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmInvites } from "@/lib/db/invites";
import { getFirmSeatUsage } from "@/lib/billing/seats";
import { inviteState } from "@/lib/team/invites";
import { getBrandingImageUrl } from "@/lib/storage";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { listClients } from "@/lib/db/clients";
import {
  computeEngagementWorkload,
  workloadForMember,
} from "@/lib/team/workload";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { FirmTabs } from "@/components/firm/firm-tabs";
import { StateChip } from "@/components/firm/state-chip";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// THE FIRM WORKSPACE — PREVIEW.
//
// A NEW route at /firm/preview. Nothing existing was modified to build it: not
// the app shell, not TeamManager, not /settings/team, not even the orphaned
// /firm redirect. /settings/team keeps working exactly as it does today, so
// this can be looked at, argued with, and thrown away at zero cost.
//
// WHAT IT'S TRYING TO SHOW, from the Canopy screenshots:
//   · Two-layer navigation where layer one never moves. Layer one is Vylan's
//     OWN sidebar (the app shell's, untouched); this page renders layer two
//     beside it. An earlier design had the firm REPLACE the sidebar, which is
//     why its most important control became a "Back to Vylan" button.
//   · One card per subject on a light ground, hairlines inside it.
//   · Tall rows, 38px avatars, wide-tracked column heads — the restraint from
//     Karbon's real Colleagues screen.
//   · A NEUTRAL capsule with a coloured dot instead of a coloured pill, and NO
//     capsule at all on a row with nothing to say.
//
// WHAT IT DELIBERATELY DOES NOT SHOW: the mockup's Job roles, Teams and Access
// columns. Those features do not exist yet (Phase 2 and Phase 5). Rendering
// empty columns for them would make the page a lie about what the product does,
// so every column here is backed by data that is real today.
//
// Everything is read from the same loaders /settings/team already uses — no new
// queries, no new business logic, nothing that could behave differently.
// ─────────────────────────────────────────────────────────────────────────────

export default async function FirmPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);
  // Team mode off = there is no firm to show. Same gate /settings/team uses.
  if (!firm.team_enabled) notFound();

  const canManage = user.role === "owner";
  const [members, invites, usage] = await Promise.all([
    listFirmUsers(),
    canManage ? listFirmInvites() : Promise.resolve([]),
    canManage ? getFirmSeatUsage(firm.id) : Promise.resolve(null),
  ]);

  const t = await getTranslations("Team");
  const tApp = await getTranslations("App");
  const tBilling = await getTranslations("Billing");
  const tAudit = await getTranslations("Audit");

  const avatars = await Promise.all(
    members.map((m) => getBrandingImageUrl(m.avatar_path)),
  );
  const avatarById = new Map(members.map((m, i) => [m.id, avatars[i]]));

  // Workload is owner-only, exactly as on /settings/team — staff never pay for
  // the worklist scan and never see the counts.
  let byMember: Record<
    string,
    { activeEngagements: number; readyToReview: number; needsAttention: number }
  > = {};
  const clientsByOwner = new Map<string, number>();
  if (canManage) {
    const [worklist, clientsRaw] = await Promise.all([
      loadEngagementWorklist("active"),
      listClients(),
    ]);
    byMember = computeEngagementWorkload(
      worklist.map((w) => ({
        assigneeUserId: w.assigneeUserId,
        readyToReview: w.readyToReview,
        daysOverdue: w.daysOverdue,
      })),
    ).byMember;
    for (const c of clientsRaw) {
      if (c.assigned_user_id) {
        clientsByOwner.set(
          c.assigned_user_id,
          (clientsByOwner.get(c.assigned_user_id) ?? 0) + 1,
        );
      }
    }
  }

  const nameById = new Map(members.map((m) => [m.id, userDisplayLabel(m)]));
  const invitedByName = (id: string | null) =>
    id ? (nameById.get(id) ?? null) : null;

  const active = members
    .filter((m) => !m.deactivated_at)
    .sort((a, b) =>
      a.role === b.role
        ? userDisplayLabel(a).localeCompare(userDisplayLabel(b))
        : a.role === "owner"
          ? -1
          : 1,
    );
  const removed = members.filter((m) => m.deactivated_at);

  const cap = usage && Number.isFinite(usage.cap) ? usage.cap : null;
  const seatLabel = usage
    ? cap == null
      ? t("seats_unlimited", { used: usage.total })
      : t("seats_used", { used: usage.total, cap })
    : null;

  // Reads top to bottom as: here now → on the way in → gone. An invitation is
  // listed with the people because it already HOLDS A SEAT — kept on a page of
  // its own, the roster quietly understates the size of the firm.
  return (
    <div className="space-y-5">
      {/* The firm's identity, then its tabs — Canopy's client-page shape. The
          name is the H1 because every tab below is a view of THIS firm, not a
          separate destination. */}
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {firm.name}
        </h1>
        {seatLabel && (
          <p className="mt-0.5 text-sm text-muted-foreground">{seatLabel}</p>
        )}
      </header>

      <FirmTabs
        current="people"
        labels={{
          people: t("section_active"),
          settings: tApp("nav_settings"),
          billing: tBilling("title"),
          audit: tAudit("title"),
        }}
      />

      <div className="min-w-0">
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          {canManage ? t("subtitle") : t("subtitle_readonly")}
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  <Th>{t("workload_col_member")}</Th>
                  <Th>{t("col_access")}</Th>
                  {canManage && (
                    <>
                      <Th num>{t("workload_col_active")}</Th>
                      <Th num>{t("workload_col_review")}</Th>
                      <Th num>{t("workload_col_attention")}</Th>
                      <Th num>{t("workload_col_clients")}</Th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {active.map((m) => {
                  const w = workloadForMember(byMember, m.id);
                  return (
                    <Row key={m.id}>
                      <Person
                        name={userDisplayLabel(m)}
                        email={m.email}
                        avatarUrl={avatarById.get(m.id) ?? null}
                        href={`/settings/team/${m.id}`}
                        suffix={m.id === user.id ? t("you") : null}
                      />
                      <Td muted>
                        {m.role === "owner" ? t("role_owner") : t("role_staff")}
                      </Td>
                      {canManage && (
                        <>
                          <Count value={w.activeEngagements} />
                          <Count value={w.readyToReview} tone="accent" />
                          <Count value={w.needsAttention} tone="warning" />
                          <Count value={clientsByOwner.get(m.id) ?? 0} />
                        </>
                      )}
                    </Row>
                  );
                })}

                {invites.map((inv) => (
                  <Row key={inv.id}>
                    <Person
                      name={inv.email}
                      email={
                        invitedByName(inv.invited_by_user_id)
                          ? t("invited_by_name", {
                              name: invitedByName(inv.invited_by_user_id)!,
                            })
                          : null
                      }
                      avatarUrl={null}
                      chip={
                        <StateChip
                          label={
                            inviteState(inv) === "expired"
                              ? t("invite_expired")
                              : t("invite_chip_pending")
                          }
                          tone={
                            inviteState(inv) === "expired" ? "warn" : "wait"
                          }
                        />
                      }
                    />
                    <Td muted>{t("role_staff")}</Td>
                    {canManage && (
                      <>
                        <Dash /> <Dash /> <Dash /> <Dash />
                      </>
                    )}
                  </Row>
                ))}

                {removed.map((m) => (
                  <Row key={m.id}>
                    <Person
                      name={userDisplayLabel(m)}
                      email={m.email}
                      avatarUrl={avatarById.get(m.id) ?? null}
                      dimmed
                      chip={
                        <StateChip label={t("profile_deactivated")} tone="neutral" />
                      }
                    />
                    <Td muted>
                      <span className="text-muted-foreground/60">&mdash;</span>
                    </Td>
                    {canManage && (
                      <>
                        <Dash /> <Dash /> <Dash /> <Dash />
                      </>
                    )}
                  </Row>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 max-w-[70ch] text-xs text-muted-foreground">
          {/* Says the rule out loud, because it IS the design: an ordinary
              active teammate carries no capsule at all. */}
          {t("preview_capsule_note")}
        </p>
      </div>
    </div>
  );
}

// Wide-tracked, quiet, and right-aligned for numbers so tabular figures share a
// units column — centring throws that away and 1, 15 and 44 stop lining up.
function Th({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground",
        num ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/40">
      {children}
    </tr>
  );
}

function Td({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td className={cn("px-4 py-4", muted && "text-muted-foreground")}>
      {children}
    </td>
  );
}

// Zero renders as an em-dash. A teammate with a clear plate used to read
// "0 0 0 2", and four zeros compete for attention with the numbers that mean
// something; the dash says "nothing here" and gets out of the way.
function Count({
  value,
  tone,
}: {
  value: number;
  tone?: "accent" | "warning";
}) {
  if (value === 0) return <Dash />;
  return (
    <td className="px-4 py-4 text-right">
      <span
        className={cn(
          "tabular-nums",
          tone === "accent"
            ? "font-semibold text-accent"
            : tone === "warning"
              ? "font-semibold text-warning"
              : "font-medium text-foreground",
        )}
      >
        {value}
      </span>
    </td>
  );
}

function Dash() {
  return (
    <td className="px-4 py-4 text-right text-muted-foreground/50">&mdash;</td>
  );
}

function Person({
  name,
  email,
  avatarUrl,
  href,
  chip,
  suffix,
  dimmed,
}: {
  name: string;
  email: string | null;
  avatarUrl: string | null;
  href?: string;
  chip?: React.ReactNode;
  suffix?: string | null;
  dimmed?: boolean;
}) {
  return (
    <td className="px-4 py-4">
      <div className="flex items-center gap-3">
        <AvatarInitials src={avatarUrl} name={name} size={38} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center">
            {href ? (
              <Link
                href={href}
                className="truncate font-medium text-accent hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span
                className={cn(
                  "truncate font-medium",
                  dimmed && "font-normal text-muted-foreground",
                )}
              >
                {name}
              </span>
            )}
            {suffix && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {suffix}
              </span>
            )}
            {chip}
          </div>
          {email && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {email}
            </div>
          )}
        </div>
      </div>
    </td>
  );
}
