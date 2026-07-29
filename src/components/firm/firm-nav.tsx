import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Users, SlidersHorizontal, CreditCard, Clock } from "lucide-react";

// Layer TWO of the firm workspace's navigation.
//
// The idea taken from Canopy: navigation is two layers and the first one never
// moves. Layer one here is Vylan's OWN sidebar — the app shell's, unchanged —
// and this panel sits beside it inside the content area. That's deliberate: an
// earlier design had the firm REPLACE the sidebar, which is why its most
// important control ended up being a "Back to Vylan" button. Nothing to go back
// from if nothing was taken away.
//
// A pure SERVER component: links only, no function props, so nothing crosses
// the RSC boundary. Every destination below is a route that already exists —
// there are no placeholders, because a nav item that goes nowhere is worse than
// a missing one.
export async function FirmNav({
  firmName,
  firmLogoUrl,
  seatLabel,
  current,
}: {
  firmName: string;
  firmLogoUrl: string | null;
  // "5 of 10 seats used" — already computed by the caller (owner-only data).
  seatLabel: string | null;
  current: "people";
}) {
  const t = await getTranslations("Team");
  const tApp = await getTranslations("App");
  const tBilling = await getTranslations("Billing");
  const tAudit = await getTranslations("Audit");

  const items: {
    key: string;
    label: string;
    href: string;
    icon: typeof Users;
    active: boolean;
  }[] = [
    {
      key: "people",
      label: t("section_active"),
      href: "/firm/preview",
      icon: Users,
      active: current === "people",
    },
    {
      key: "settings",
      label: tApp("nav_settings"),
      href: "/settings?tab=team",
      icon: SlidersHorizontal,
      active: false,
    },
    {
      key: "plan",
      label: tBilling("title"),
      href: "/billing",
      icon: CreditCard,
      active: false,
    },
    {
      key: "audit",
      label: tAudit("title"),
      href: "/settings/audit",
      icon: Clock,
      active: false,
    },
  ];

  return (
    <nav
      aria-label={firmName}
      className="flex w-full shrink-0 flex-col rounded-xl border border-border/60 bg-card lg:w-60"
    >
      <div className="flex items-center gap-3 border-b border-border/60 p-4">
        <AvatarInitials src={firmLogoUrl} name={firmName} size={36} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{firmName}</div>
          {seatLabel && (
            <div className="truncate text-xs text-muted-foreground">
              {seatLabel}
            </div>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 p-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.key}>
              <Link
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  it.active
                    ? "bg-accent-subtle font-medium text-accent"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    it.active ? "text-accent" : "text-muted-foreground",
                  )}
                />
                <span className="truncate">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
