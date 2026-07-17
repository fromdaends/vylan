import { AvatarInitials } from "@/components/ui/avatar-initials";

// "Worked on by" strip on the engagement header — the distinct teammates who've
// acted on this file, at a glance, so the accountability answer ("who prepared /
// touched this return") is one look, not a scroll through the activity feed.
// Read-only; the page resolves names + a last-active tooltip.
export function EngagementContributors({
  label,
  contributors,
}: {
  label: string;
  contributors: { userId: string; name: string; title: string }[];
}) {
  if (contributors.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {contributors.map((c) => (
          <span
            key={c.userId}
            title={c.title}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/40 py-0.5 pl-0.5 pr-2 text-xs"
          >
            <AvatarInitials name={c.name} size={18} />
            <span className="text-foreground">{c.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
