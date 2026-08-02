"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoreHorizontal, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ComboboxClient } from "@/components/clients/client-combobox";
import {
  RelationshipFormDialog,
  type RelationshipEditTarget,
} from "@/components/clients/relationship-form-dialog";
import {
  removeRelationshipAction,
  restoreRelationshipAction,
} from "@/app/actions/relationships";
import type {
  RelationshipScope,
  RelationshipType,
} from "@/lib/relationships/validate";

// One row of the profile card, direction already resolved server-side and the
// other end's name already joined — this component only renders and manages.
export type RelationshipCardRow = {
  id: string;
  relType: RelationshipType;
  direction: "out" | "in";
  otherClientId: string;
  otherName: string;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
};

// Beyond this many rows the card shows a "View all (N)" line that expands it
// inline — the rail card must stay a compact reference, not a second table.
const VISIBLE_ROWS = 6;

// The Relationships rail card (spec §2): a compact indented tree, one link per
// row — muted label (with percentage / scopes) + the linked client's name as a
// link to their profile. Renders the SAME section anatomy as the profile's
// Panel (uppercase muted header band, border, padding) — keep the classes in
// lockstep with Panel in clients/[id]/page.tsx.
export function RelationshipsCard({
  clientId,
  clientType,
  rows,
  candidates,
  canManage,
}: {
  clientId: string;
  clientType: "individual" | "business";
  rows: RelationshipCardRow[];
  candidates: { individuals: ComboboxClient[]; businesses: ComboboxClient[] };
  canManage: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RelationshipEditTarget | null>(
    null,
  );

  const overflowing = rows.length > VISIBLE_ROWS;
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS);

  function scopeSummary(scopes: RelationshipScope[] | null): string {
    return (scopes ?? []).map((s) => t(`rel_scope_${s}`)).join(", ");
  }

  // The muted label half of a row. Percentage and scopes are part of the
  // label (spec), so the name stays the only emphasized text on the line.
  function rowLabel(row: RelationshipCardRow): string {
    if (row.relType === "spouse_of") return t("rel_spouse");
    if (row.relType === "owner_of") {
      return row.direction === "out"
        ? t("rel_owns", { pct: row.percentage ?? 0 })
        : t("rel_owner", { pct: row.percentage ?? 0 });
    }
    return t("rel_contact", { scopes: scopeSummary(row.scopes) });
  }

  function remove(row: RelationshipCardRow) {
    startTransition(async () => {
      const res = await removeRelationshipAction(row.id);
      if (!res.ok) {
        toast.error(t("rel_err_generic"));
        return;
      }
      router.refresh();
      toast(t("rel_removed"), {
        action: {
          label: t("rel_undo"),
          onClick: () => {
            startTransition(async () => {
              const restored = await restoreRelationshipAction(row.id);
              if (restored.ok) router.refresh();
              else toast.error(t("rel_restore_failed"));
            });
          },
        },
      });
    });
  }

  return (
    // Same anatomy as Panel in clients/[id]/page.tsx. The id anchors the
    // engagement header's "linked clients" line.
    <section
      id="relationships"
      className="overflow-hidden rounded-xl border border-border/60 bg-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {t("rel_title")}
        </h2>
        {canManage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            aria-label={t("rel_add")}
            title={t("rel_add")}
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">{t("rel_empty")}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((row, i) => {
              // When the card overflows, the View-all/Show-less row is always
              // the tree's last line, whichever state it's in.
              const isLastLine = i === visible.length - 1 && !overflowing;
              return (
                <li
                  key={row.id}
                  className="group flex min-w-0 items-center gap-1.5 text-sm"
                >
                  <span
                    aria-hidden
                    className="shrink-0 select-none font-mono text-xs text-muted-foreground/50"
                  >
                    {isLastLine ? "└─" : "├─"}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {rowLabel(row)}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-muted-foreground/60"
                  >
                    ·
                  </span>
                  <Link
                    href={`/clients/${row.otherClientId}`}
                    title={row.otherName}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  >
                    {row.otherName}
                  </Link>
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label={t("rel_row_actions")}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {row.relType !== "spouse_of" && (
                          <DropdownMenuItem
                            onSelect={() =>
                              setEditTarget({
                                id: row.id,
                                relType: row.relType,
                                otherName: row.otherName,
                                percentage: row.percentage,
                                scopes: row.scopes,
                              })
                            }
                          >
                            {t("rel_edit")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => remove(row)}
                          className="text-destructive focus:text-destructive"
                        >
                          {t("rel_remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
            {overflowing && (
              <li className="flex items-center gap-1.5 text-sm">
                <span
                  aria-hidden
                  className="shrink-0 select-none font-mono text-xs text-muted-foreground/50"
                >
                  └─
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded
                    ? t("rel_show_less")
                    : t("rel_view_all", { count: rows.length })}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {canManage && (
        <>
          <RelationshipFormDialog
            key="add"
            open={addOpen}
            onOpenChange={setAddOpen}
            profile={{ id: clientId, type: clientType }}
            candidates={candidates}
          />
          <RelationshipFormDialog
            key={editTarget?.id ?? "edit"}
            open={editTarget != null}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
            profile={{ id: clientId, type: clientType }}
            candidates={candidates}
            edit={editTarget}
          />
        </>
      )}
    </section>
  );
}
