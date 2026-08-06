// THE TEAM BOX (design 2a) — who is on this job, right rail.
//
// Rows are the read: 28px face, name, caption (the primary assignee is
// "Assignee", the rest are on the job). The WRITE is the existing
// EngagementAssigneesControl mounted under the rows — the same facepile +
// picker the details card carried, so adding or removing a person stays ONE
// implementation. The handoff note and the per-job access control (rare, but
// a grant you cannot see is a grant you cannot revoke) keep their homes here
// too, since the header row they lived on is gone.

import { getTranslations } from "next-intl/server";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { RailBox } from "@/components/engagements/engagement-rail-box";

export async function EngagementTeamBox({
  people,
  control,
  handoff,
  access,
  style,
}: {
  /** Primary first — the page resolves order via resolveAssignees. */
  people: { id: string; name: string; primary: boolean }[];
  /** EngagementAssigneesControl, mounted by the page (team mode only). */
  control: React.ReactNode;
  handoff: { note: string; from: string | null; at: string } | null;
  /** EngagementAccess when this job has guests, else null. */
  access: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = await getTranslations("Engagements");

  return (
    <RailBox title={t("box_team")} className="animate-card-in" style={style}>
      {people.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <AvatarInitials name={p.name} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">
                  {p.name}
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  {p.primary ? t("team_role_assignee") : t("team_role_member")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {control && <div className="mt-3">{control}</div>}
      {handoff && (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {handoff.from ?? t("team_handoff")}
          </span>{" "}
          · {handoff.at} — {handoff.note}
        </p>
      )}
      {access && <div className="mt-3 border-t border-border/60 pt-3">{access}</div>}
    </RailBox>
  );
}
