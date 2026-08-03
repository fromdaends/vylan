// "You can see this client exists. You cannot open it. Here is who to ask."
//
// The middle privacy level from phase 3 of the roadmap. Before migration 1280 a
// client had two states — on your list, or gone — so a staff member who needed
// something from a file they were not on could not learn it existed, let alone
// who to ask. They had to go and ask somebody a question about a thing they
// could not name.
//
// The page therefore has exactly one job: NAME THE PEOPLE. Not a 404, which
// tells you nothing; not a paragraph about permissions, which nobody reads; a
// short line and a list of who to go to.
//
// DELIBERATELY THIN, and it must stay that way. Every field added here is one
// more thing 'listed' leaks, and a page that gains a detail per release ends up
// being full access by accretion. Name, who to ask, and nothing else.

import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Panel } from "@/components/ui/panel";

export async function ClientLocked({
  clientName,
  breadcrumbLabel,
  clientsLabel,
  people,
}: {
  clientName: string;
  breadcrumbLabel: string;
  clientsLabel: string;
  /** Who to ask, most responsible first. Empty is possible and handled. */
  people: { id: string; name: string; position: string | null }[];
}) {
  const t = await getTranslations("Clients");

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumb
        label={breadcrumbLabel}
        items={[{ label: clientsLabel, href: "/clients" }, { label: clientName }]}
      />

      <header className="overflow-hidden rounded-xl border border-border/60 bg-card p-6">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-hidden
          >
            <Lock className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {clientName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("locked_body")}
            </p>
          </div>
        </div>
      </header>

      <Panel title={t("locked_ask_title")}>
        {people.length === 0 ? (
          // A listed client with nobody on its list. Rare, and the honest
          // answer is "the firm owner" rather than an empty box that reads as
          // a bug.
          <p className="text-sm text-muted-foreground">{t("locked_ask_none")}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <AvatarInitials name={p.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}
                  </span>
                  {p.position && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.position}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
