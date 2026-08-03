"use client";

// The team editor, in the two places a team gets set.
//
// ONE COMPONENT, TWO MODES, on purpose. It is used on the client page — where
// every change hits the database immediately — and inside the create dialog,
// where there is no client to attach anyone to yet, so the choices are held
// until the form is submitted. Written twice, the two would drift: the create
// form would quietly lack positions, or gain a confirm the panel does not have,
// and the founder's rule that "everything correlates" would break at exactly
// the seam nobody looks at.
//
//   mode="live"   → onAdd / onRemove / onPosition hit the server, one call each.
//   mode="draft"  → onChange hands the whole list back; nothing is saved yet.
//
// The markup is identical in both. That is the point.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TeamRow = { userId: string; name: string; position: string | null };
type Person = { id: string; name: string };

export function ClientTeamEditor(props: {
  rows: TeamRow[];
  /** Everyone who could be added — the roster minus whoever is already on. */
  candidates: Person[];
  canEdit: boolean;
  busyId?: string | null;
  /** Rendered under the list when there is nobody on the team. */
  emptyLabel: string;
  mode: "live" | "draft";
  onAdd?: (userId: string) => void;
  onRemove?: (userId: string) => void;
  onPosition?: (userId: string, position: string | null) => void;
}) {
  const t = useTranslations("Clients");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = (userId: string) => {
    props.onPosition?.(userId, draft.trim() || null);
    setEditing(null);
  };

  return (
    <div className="space-y-2">
      {props.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {props.rows.map((m) => (
            <li key={m.userId} className="group flex items-center gap-2.5">
              <AvatarInitials name={m.name} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{m.name}</span>
                {editing === m.userId ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(m.userId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit(m.userId);
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    placeholder={t("team_position_placeholder")}
                    maxLength={60}
                    aria-label={t("team_position")}
                    className="mt-0.5 w-full rounded border border-input bg-background px-1 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ) : props.canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(m.userId);
                      setDraft(m.position ?? "");
                    }}
                    className="block truncate rounded text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {m.position ?? t("team_position_add")}
                  </button>
                ) : (
                  m.position && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.position}
                    </span>
                  )
                )}
              </span>
              {props.canEdit && (
                <button
                  type="button"
                  onClick={() => props.onRemove?.(m.userId)}
                  disabled={props.busyId === m.userId}
                  aria-label={t("team_remove", { name: m.name })}
                  title={t("team_remove", { name: m.name })}
                  className="shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.canEdit && props.candidates.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("team_add")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {props.candidates.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => props.onAdd?.(c.id)}
                className="gap-2"
              >
                <AvatarInitials name={c.name} size={20} />
                <span className="flex-1 truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
