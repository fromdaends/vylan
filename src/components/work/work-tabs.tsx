// The two halves of Work, as a tab row.
//
// Tasks and Engagements are separate lists because they are separate objects —
// a job carries a portal, stages and payments; a task carries a checkbox. What
// they share is the question they answer, so they share a header.
//
// A PLAIN module rendered by Server Components, not a "use client" one: these
// are links, and a client boundary here would be a client reference passed
// where a server one is expected (the #959 lesson).

import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";

export async function WorkTabs({
  current,
}: {
  current: "tasks" | "engagements";
}) {
  const t = await getTranslations("Engagements");
  const items = [
    { key: "tasks" as const, href: "/work", label: t("work_tab_tasks") },
    {
      key: "engagements" as const,
      href: "/engagements",
      label: t("work_tab_engagements"),
    },
  ];

  return (
    <div className="flex items-center gap-4 border-b border-border">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={current === i.key ? "page" : undefined}
          className={cn(
            // -mb-px so the active underline sits on the bar's own border.
            "-mb-px border-b-2 px-1 py-2 text-base font-semibold tracking-tight transition-colors",
            current === i.key
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
