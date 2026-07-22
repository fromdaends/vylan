import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/cn";
import { ArrowRight, Users } from "lucide-react";

// Team Wave 2 — the firm-wide workload roll-up (owner-only). One row per active
// member: active engagements, how many are ready for review, how many need
// attention (overdue), and their client count. Each row links to that person's
// profile; unowned work rolls into an "Unassigned" row so it's visible. A pure
// SERVER component (links only, no function props → safe across the RSC boundary).

export type TeamWorkloadRow = {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  activeEngagements: number;
  readyToReview: number;
  needsAttention: number;
  clients: number;
};

export type TeamWorkloadUnassigned = {
  activeEngagements: number;
  readyToReview: number;
  needsAttention: number;
};

export async function TeamWorkloadTable({
  rows,
  unassigned,
}: {
  rows: TeamWorkloadRow[];
  unassigned: TeamWorkloadUnassigned;
}) {
  const t = await getTranslations("Team");

  // A count cell: muted at zero, tinted (accent for review, warning for
  // attention) when there's something to act on.
  const Count = ({
    value,
    tone,
  }: {
    value: number;
    tone?: "accent" | "warning";
  }) => (
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

  return (
    <section className="rounded-xl border border-border/50">
      <header className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        <Users className="h-4 w-4 text-icon-cyan" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold">{t("workload_title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("workload_subtitle")}
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">
                {t("workload_col_member")}
              </th>
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
              <th className="px-3 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/30 last:border-0 hover:bg-secondary/40"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/settings/team/${r.id}`}
                    className="group flex items-center gap-2.5"
                  >
                    <AvatarInitials name={r.name} src={r.avatarUrl} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">
                        {r.name}
                      </span>
                      {r.role === "owner" && (
                        <span className="text-[11px] text-muted-foreground">
                          {t("role_owner")}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={r.activeEngagements} />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={r.readyToReview} tone="accent" />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={r.needsAttention} tone="warning" />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={r.clients} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    href={`/settings/team/${r.id}`}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                    aria-label={t("workload_view_person", { name: r.name })}
                  >
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}

            {unassigned.activeEngagements > 0 && (
              <tr className="border-t border-border/40 bg-muted/20">
                <td className="px-4 py-2.5">
                  <Link
                    href="/engagements"
                    className="flex items-center gap-2.5 text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px]">
                      —
                    </span>
                    <span className="font-medium">
                      {t("workload_unassigned")}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={unassigned.activeEngagements} />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={unassigned.readyToReview} tone="accent" />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={unassigned.needsAttention} tone="warning" />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Count value={0} />
                </td>
                <td className="px-3 py-2.5" aria-hidden />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
