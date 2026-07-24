"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  UserPlus,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Mail,
  Clock,
  Check,
  Lock,
  Building2,
  Users,
  LogOut,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createInvite,
  revokeInvite,
  resendInvite,
  deactivateUser,
  reactivateUser,
  transferOwnership,
  createTeam,
  leaveTeam,
} from "@/app/actions/team";
import { BookCallButton } from "@/components/booking/book-call-button";

type Seat = { used: number; cap: number | null; atCap: boolean };
type ActiveMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  isSelf: boolean;
  avatarUrl: string | null;
  // Live workload (only computed for owners): active engagements, how many are
  // ready to review, how many need attention (overdue), and client count. Shown
  // inline in the roster row and used by the guarded-offboarding dialog.
  activeEngagements?: number;
  readyToReview?: number;
  needsAttention?: number;
  clients?: number;
};
type DeactivatedMember = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  deactivatedAt: string | null;
  deactivatedByName: string | null;
};
type PendingInvite = {
  id: string;
  email: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

// Maps a server action's error code to a friendly, localized message.
function useErrorMessage() {
  const t = useTranslations("Team");
  return (error: string | undefined, cap?: number) => {
    switch (error) {
      case "seat_limit":
        return t("error_seat_limit", { cap: cap ?? 0 });
      case "email_exists":
        return t("error_email_exists");
      case "already_member":
        return t("error_already_member");
      case "already_invited":
        return t("error_already_invited");
      case "invalid_email":
        return t("error_invalid_email");
      case "cannot_deactivate_self":
        return t("error_cannot_deactivate_self");
      case "cannot_deactivate_only_owner":
        return t("error_cannot_deactivate_only_owner");
      case "owner_only":
        return t("error_owner_only");
      case "trial_locked_team":
        return t("error_trial_locked_team");
      case "team_disabled":
        return t("error_team_disabled");
      case "team_has_members":
        return t("error_team_has_members");
      case "team_has_invites":
        return t("error_team_has_invites");
      default:
        return t("error_generic");
    }
  };
}

export function TeamManager({
  firmName,
  canManage,
  onTrial,
  seat,
  activeMembers,
  deactivatedMembers,
  pendingInvites,
  locale,
  unassignedWorkload,
  firmSettings,
}: {
  // The firm's name — shown as the page heading (this is the firm's team).
  firmName: string;
  // Owners see the full manager; staff get a read-only roster (no invite,
  // deactivate, transfer, or seat controls).
  canManage: boolean;
  // On an active free trial the team feature stays visible but locked: invites
  // and extra seats unlock once the firm converts to a paid plan.
  onTrial: boolean;
  seat: Seat;
  activeMembers: ActiveMember[];
  deactivatedMembers: DeactivatedMember[];
  pendingInvites: PendingInvite[];
  locale: "fr" | "en";
  // Unassigned live work (owner-only) — shown as a trailing row in the roster
  // table so unowned work stays visible after the workload merge.
  unassignedWorkload?: {
    activeEngagements: number;
    readyToReview: number;
    needsAttention: number;
  };
  // Firm-wide settings, rendered inside the ⋯ (top-right) dialog — not inline.
  firmSettings?: ReactNode;
}) {
  const t = useTranslations("Team");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [firmOpen, setFirmOpen] = useState(false);
  const showStats = canManage;

  const seatLabel =
    seat.cap == null
      ? t("seats_unlimited", { used: seat.used })
      : t("seats_used", { used: seat.used, cap: seat.cap });
  const pct =
    seat.cap == null || seat.cap === 0
      ? 0
      : Math.min(100, Math.round((seat.used / seat.cap) * 100));

  return (
    <section className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {firmName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage ? t("subtitle") : t("subtitle_readonly")}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={onTrial || seat.atCap}
              title={
                onTrial
                  ? t("trial_locked_short")
                  : seat.atCap
                    ? t("seats_at_cap", { cap: seat.cap ?? 0 })
                    : undefined
              }
              onClick={() => setInviteOpen(true)}
            >
              {onTrial ? (
                <Lock className="size-4" />
              ) : (
                <UserPlus className="size-4" />
              )}
              {t("invite_button")}
            </Button>
            {/* Firm-level config lives behind this ⋯ menu (top-right), not inline:
                "Firm settings" opens the settings dialog; "Edit firm details"
                jumps to Settings > Account (logo/name/brand/language). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("firm_menu_label")}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {firmSettings && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setFirmOpen(true);
                    }}
                    className="gap-2"
                  >
                    <SlidersHorizontal className="size-4" />
                    {t("firm_settings_title")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild className="gap-2">
                  <Link href="/settings?tab=account">
                    <Building2 className="size-4" />
                    {t("edit_firm")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Firm settings dialog (opened from the ⋯ menu). */}
      {firmSettings && (
        <Dialog open={firmOpen} onOpenChange={setFirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("firm_settings_title")}</DialogTitle>
              <DialogDescription>{t("firm_settings_subtitle")}</DialogDescription>
            </DialogHeader>
            {firmSettings}
          </DialogContent>
        </Dialog>
      )}

      {/* Seat usage (owner-only). On an active free trial we swap the seat
          meter for a "locked — book a call to unlock your team" panel. */}
      {canManage &&
        (onTrial ? (
          <TrialTeamLock />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{seatLabel}</span>
              {seat.atCap && (
                <span className="text-xs text-warning">
                  {t("seats_at_cap", { cap: seat.cap ?? 0 })}
                </span>
              )}
            </div>
            {seat.cap != null && (
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={seatLabel}
              >
                <div
                  className={
                    "h-full rounded-full transition-all " +
                    (seat.atCap ? "bg-warning" : "bg-primary")
                  }
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        ))}

      {/* Active members — MERGED with the workload roll-up: one row per member
          showing who they are + their live workload (Active / To review / Needs
          attention / Clients), so there's no separate duplicate table. Stats show
          for owners only; unowned work rolls into a trailing "Unassigned" row. */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("section_active")}</h2>
          {showStats && (
            <span className="text-xs text-muted-foreground">
              {t("workload_subtitle")}
            </span>
          )}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">
                  {t("workload_col_member")}
                </th>
                {showStats && (
                  <>
                    <th className="px-3 py-2 text-center font-medium">
                      {t("workload_col_active")}
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      {t("workload_col_review")}
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      {t("workload_col_attention")}
                    </th>
                    <th className="px-3 py-2 text-center font-medium">
                      {t("workload_col_clients")}
                    </th>
                  </>
                )}
                <th className="py-2 pl-3" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {activeMembers.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  showStats={showStats}
                  canManage={canManage && !m.isSelf && m.role !== "owner"}
                  canViewProfile={canManage}
                  // Who this person's work can be handed to on removal: any OTHER
                  // active member (owner included). Empty → no reassign option.
                  reassignTargets={activeMembers
                    .filter((x) => x.id !== m.id)
                    .map((x) => ({ id: x.id, name: x.name }))}
                />
              ))}
              {showStats &&
                unassignedWorkload &&
                unassignedWorkload.activeEngagements > 0 && (
                  <tr className="border-t border-border/40 bg-muted/20">
                    <td className="py-3 pr-3">
                      <Link
                        href="/engagements"
                        className="flex items-center gap-3 text-muted-foreground transition-colors hover:text-foreground hover:underline"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs">
                          —
                        </span>
                        <span className="font-medium">
                          {t("workload_unassigned")}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Count value={unassignedWorkload.activeEngagements} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Count
                        value={unassignedWorkload.readyToReview}
                        tone="accent"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Count
                        value={unassignedWorkload.needsAttention}
                        tone="warning"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Count value={0} />
                    </td>
                    <td className="py-3 pl-3" aria-hidden />
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending invitations (owner-only; hidden on trial — none can exist) */}
      {canManage && !onTrial && (
        <div>
          <h2 className="text-sm font-semibold">{t("section_pending")}</h2>
          {pendingInvites.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("pending_empty")}
            </p>
          ) : (
            <div className="mt-3 border-t border-border/60">
              {pendingInvites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} locale={locale} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Deactivated members (collapsed, owner-only) */}
      {canManage && deactivatedMembers.length > 0 && (
        <DeactivatedSection members={deactivatedMembers} locale={locale} />
      )}

      {/* Transfer ownership — owner-only, and only when there's an active
          staff member to hand to. */}
      {canManage && activeMembers.some((m) => m.role === "staff") && (
        <TransferOwnership
          staff={activeMembers
            .filter((m) => m.role === "staff")
            .map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }))}
        />
      )}

      {canManage && <LeaveTeamSection />}

      {canManage && (
        <InviteModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          defaultLocale={locale}
        />
      )}
    </section>
  );
}

// Empty state shown after the owner leaves/disbands their one-person team.
// The firm workspace remains intact; creating a team simply restores the
// collaboration controls and historical assignment labels.
export function TeamSetup({ firmName }: { firmName: string }) {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createTeam();
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("create_team_success"));
      router.refresh();
    });
  }

  return (
    <section className="mx-auto max-w-2xl py-12">
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="size-6" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {t("create_team_title")}
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          {t("create_team_body", { firm: firmName })}
        </p>
        <Button className="mt-6" onClick={handleCreate} disabled={pending}>
          <UserPlus className="size-4" />
          {pending ? t("creating_team") : t("create_team")}
        </Button>
      </div>
    </section>
  );
}

function LeaveTeamSection() {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmLeave() {
    startTransition(async () => {
      const result = await leaveTeam();
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return;
      }
      setOpen(false);
      toast.success(t("leave_team_success"));
      router.refresh();
    });
  }

  return (
    <div className="border-t border-border/60 pt-8">
      <div className="flex flex-col gap-3 rounded-xl border border-destructive/25 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("leave_team_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("leave_team_hint")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <LogOut className="size-4" />
          {t("leave_team")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leave_team_confirm_title")}</DialogTitle>
            <DialogDescription>{t("leave_team_confirm_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmLeave}
              disabled={pending}
            >
              {pending ? t("leaving_team") : t("leave_team_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Free-trial lock for the team feature: the roster stays visible (just the
// owner) but inviting teammates / adding seats is gated behind converting to a
// paid plan. Rendered in place of the seat meter while the firm is on trial.
function TrialTeamLock() {
  const t = useTranslations("Team");
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Lock className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t("trial_locked_title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("trial_locked_body")}
          </p>
          <div className="mt-3">
            <BookCallButton
              label={t("trial_locked_cta")}
              variant="default"
              size="sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  showStats,
  canManage,
  canViewProfile,
  reassignTargets,
}: {
  member: ActiveMember;
  // Render the workload stat cells (owner view). Must match the table header.
  showStats: boolean;
  canManage: boolean;
  // Owners can open a teammate's profile (their engagements/clients/activity).
  canViewProfile: boolean;
  // Other active members this person's work can be reassigned to on removal.
  reassignTargets: { id: string; name: string }[];
}) {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Does this member hold live work worth reassigning? Drives the "guarded"
  // remove dialog (counts + reassignee picker) vs. the plain confirm.
  const activeEngagements = member.activeEngagements ?? 0;
  const readyToReview = member.readyToReview ?? 0;
  const needsAttention = member.needsAttention ?? 0;
  const clientCount = member.clients ?? 0;
  const holdsWork = activeEngagements > 0 || clientCount > 0;
  const canReassign = holdsWork && reassignTargets.length > 0;
  // Default the reassignee to the first available teammate (owner sorts first).
  const [reassignTo, setReassignTo] = useState<string>(
    reassignTargets[0]?.id ?? "",
  );

  // reassignToId null = "remove anyway" (leave their work as-is).
  function doDeactivate(reassignToId: string | null) {
    startTransition(async () => {
      const res = await deactivateUser(member.id, reassignToId);
      if (res.ok) {
        toast.success(t("member_deactivated"));
        router.refresh();
      } else {
        toast.error(errorMessage(res.error));
      }
      setConfirmOpen(false);
    });
  }

  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-secondary/30">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <AvatarInitials src={member.avatarUrl} name={member.name} size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {canViewProfile ? (
                <Link
                  href={`/settings/team/${member.id}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {member.name}
                </Link>
              ) : (
                <span className="truncate text-sm font-medium">
                  {member.name}
                </span>
              )}
              <Badge
                variant={member.role === "owner" ? "default" : "secondary"}
                className="shrink-0 font-normal"
              >
                {member.role === "owner" ? t("role_owner") : t("role_staff")}
              </Badge>
              {member.isSelf && (
                <span className="text-xs text-muted-foreground">{t("you")}</span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {member.email}
            </div>
          </div>
        </div>
      </td>

      {showStats && (
        <>
          <td className="px-3 py-3 text-center">
            <Count value={activeEngagements} />
          </td>
          <td className="px-3 py-3 text-center">
            <Count value={readyToReview} tone="accent" />
          </td>
          <td className="px-3 py-3 text-center">
            <Count value={needsAttention} tone="warning" />
          </td>
          <td className="px-3 py-3 text-center">
            <Count value={clientCount} />
          </td>
        </>
      )}

      <td className="py-3 pl-3">
        <div className="flex items-center justify-end gap-1">
          {/* Jump to this person's engagements (the "view a teammate's work"
              lens). Available for every active member, including yourself. */}
          <Link
            href={`/engagements?assignee=${member.id}`}
            title={t("view_engagements")}
            aria-label={t("view_engagements")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListChecks className="size-4" />
          </Link>

          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("member_actions")}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmOpen(true);
                  }}
                >
                  {t("menu_deactivate")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deactivate_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("deactivate_confirm_body", { name: member.name })}
            </DialogDescription>
          </DialogHeader>

          {/* Guarded offboarding: if this person holds live work, show it and
              offer to hand it to a teammate so nothing is orphaned. */}
          {holdsWork && (
            <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
              <p className="text-sm">
                {t("offboard_holds", {
                  name: member.name,
                  engagements: activeEngagements,
                  clients: clientCount,
                })}
              </p>
              {canReassign && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("offboard_reassign_label")}
                  </span>
                  <select
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                    disabled={pending}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {reassignTargets.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            {canReassign ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => doDeactivate(null)}
                  disabled={pending}
                >
                  {t("offboard_remove_anyway")}
                </Button>
                <Button
                  type="button"
                  onClick={() => doDeactivate(reassignTo)}
                  disabled={pending || !reassignTo}
                >
                  {t("offboard_reassign_remove")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={() => doDeactivate(null)}
                disabled={pending}
              >
                {t("menu_deactivate")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </td>
    </tr>
  );
}

// A workload count cell: muted at zero, tinted (accent for review, warning for
// attention) when there's something to act on. Shared by the roster rows.
function Count({
  value,
  tone,
}: {
  value: number;
  tone?: "accent" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[2ch] justify-center tabular-nums",
        value === 0
          ? "text-muted-foreground/60"
          : tone === "accent"
            ? "font-semibold text-accent"
            : tone === "warning"
              ? "font-semibold text-warning"
              : "font-medium text-foreground",
      )}
    >
      {value}
    </span>
  );
}

function InviteRow({
  invite,
  locale,
}: {
  invite: PendingInvite;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(fn: () => Promise<{ ok: boolean }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(t("error_generic"));
      }
    });
  }

  return (
    <div className="flex items-center gap-3 border-b border-border/40 py-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Mail className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{invite.email}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {invite.invitedByName && (
            <span>{t("invited_by_name", { name: invite.invitedByName })}</span>
          )}
          {invite.expired ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <Clock className="size-3" />
              {t("invite_expired")}
            </span>
          ) : (
            <span>
              {t("invite_expires", {
                date: new Date(invite.expiresAt).toLocaleDateString(locale),
              })}
            </span>
          )}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            aria-label={t("invite_actions")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={() =>
              act(() => resendInvite(invite.id), t("invite_resent"))
            }
          >
            {t("menu_resend")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              act(() => revokeInvite(invite.id), t("invite_revoked"))
            }
          >
            {t("menu_revoke")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DeactivatedSection({
  members,
  locale,
}: {
  members: DeactivatedMember[];
  locale: "fr" | "en";
}) {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function reactivate(id: string) {
    startTransition(async () => {
      const res = await reactivateUser(id);
      if (res.ok) {
        toast.success(t("member_reactivated"));
        router.refresh();
      } else {
        toast.error(errorMessage(res.error));
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
        {t("section_deactivated", { count: members.length })}
      </button>
      {open && (
        <div className="mt-3 border-t border-border/60">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 border-b border-border/40 py-3"
            >
              <AvatarInitials
                src={m.avatarUrl}
                name={m.name}
                size={36}
                color="#64748b"
                className="opacity-60"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-muted-foreground">
                  {m.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {m.email}
                  {m.deactivatedAt && (
                    <>
                      {" · "}
                      {t("deactivated_on", {
                        date: new Date(m.deactivatedAt).toLocaleDateString(
                          locale,
                        ),
                      })}
                    </>
                  )}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => reactivate(m.id)}
              >
                {t("reactivate")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InviteModal({
  open,
  onOpenChange,
  defaultLocale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultLocale: "fr" | "en";
}) {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [inviteLocale, setInviteLocale] = useState<"fr" | "en">(defaultLocale);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("email", email);
    fd.set("locale", inviteLocale);
    startTransition(async () => {
      const res = await createInvite(fd);
      if (res.ok) {
        toast.success(res.emailSent ? t("invite_sent") : t("invite_sent_no_email"));
        setEmail("");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(errorMessage(res.error, res.cap));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("invite_modal_title")}</DialogTitle>
          <DialogDescription>{t("invite_modal_hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="invite-email" className="text-sm font-medium">
              {t("invite_email_label")}
            </label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("invite_email_placeholder")}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">
              {t("invite_locale_label")}
            </span>
            <div className="inline-flex rounded-md bg-secondary/40 p-0.5">
              {(["fr", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setInviteLocale(l)}
                  className={
                    "rounded px-3 py-1 text-sm font-medium transition-colors " +
                    (inviteLocale === l
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {l === "fr" ? "Français" : "English"}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || email.trim() === ""}>
              <UserPlus className="size-4" />
              {t("invite_submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferOwnership({
  staff,
}: {
  staff: { id: string; name: string; avatarUrl: string | null }[];
}) {
  const t = useTranslations("Team");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!selected) return;
    startTransition(async () => {
      const res = await transferOwnership(selected);
      if (res.ok) {
        toast.success(t("ownership_transferred_toast"));
        // The caller is now a member — leave the owner-only team page.
        router.push("/settings");
      } else {
        toast.error(errorMessage(res.error));
        setOpen(false);
      }
    });
  }

  return (
    <div className="border-t border-border/40 pt-8">
      <h2 className="text-sm font-semibold">{t("transfer_title")}</h2>
      <p className="mt-1 max-w-xl text-xs text-muted-foreground">
        {t("transfer_hint")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        {t("transfer_button")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("transfer_modal_title")}</DialogTitle>
            <DialogDescription>{t("transfer_modal_warning")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {staff.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelected(m.id)}
                className={
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors " +
                  (selected === m.id
                    ? "border-primary bg-secondary/40"
                    : "border-border/60 hover:bg-secondary/30")
                }
              >
                <AvatarInitials src={m.avatarUrl} name={m.name} size={24} />
                <span className="flex-1 truncate">{m.name}</span>
                {selected === m.id && (
                  <Check className="size-4 text-primary" />
                )}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirm}
              disabled={pending || !selected}
            >
              {t("transfer_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
