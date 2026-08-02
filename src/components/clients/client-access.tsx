"use client";

// Who can see this client — the answer, not the raw table.
//
// This replaces a panel that listed `client_members` and nothing else, which
// was about to become actively misleading. Owners see every client. The
// assigned person sees theirs. Neither is in that table — so a firm reading a
// list of two names would have concluded two people could see the client, and
// been wrong in the direction that matters.
//
// Since slice 2 (migration 1220) being on this list GRANTS sight of a private
// client. Slice 3 makes it the only thing that grants sight of any client. A
// control that consequential has to report its own effect, or the first time
// somebody is quietly locked out nobody will be able to say why.
//
// So: the team is editable at the top, and underneath, in plain words, exactly
// who can see this client right now and why each of them can.

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Eye, Plus, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addClientMemberAction,
  removeClientMemberAction,
} from "@/app/actions/client-members";

type Member = { userId: string; name: string; position: string | null };
type Person = { id: string; name: string };

export function ClientAccess({
  clientId,
  isPrivate,
  members,
  owners,
  assignee,
  firmSize,
  candidates,
  canEdit,
}: {
  clientId: string;
  isPrivate: boolean;
  members: Member[];
  /** Firm owners — they see every client, membership or not. */
  owners: Person[];
  /** The person the client is assigned to, if any. */
  assignee: Person | null;
  /** Active people in the firm, for the "everyone" case. */
  firmSize: number;
  candidates: Person[];
  canEdit: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function run(fn: () => Promise<{ ok: boolean; needsMigration?: boolean }>, key: string) {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.needsMigration ? t("team_needs_migration") : t("team_failed"));
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } finally {
      setBusy(null);
    }
  }

  const savePosition = async (userId: string) => {
    const position = draft.trim() || null;
    const ok = await run(
      () => addClientMemberAction({ clientId, userId, position }),
      userId,
    );
    if (ok) setEditing(null);
  };

  // Everyone who can see the client today, and WHY — deduplicated, because an
  // owner who is also on the team is one person, not two.
  const seers: { id: string; name: string; reason: string }[] = [];
  const seen = new Set<string>();
  const push = (p: Person, reason: string) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    seers.push({ ...p, reason });
  };
  for (const o of owners) push(o, t("access_reason_owner"));
  if (assignee) push(assignee, t("access_reason_assigned"));
  for (const m of members) push({ id: m.userId, name: m.name }, t("access_reason_member"));

  return (
    <div className="space-y-4">
      {/* ── The team ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("team_empty")}</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.userId} className="group flex items-center gap-2.5">
                <AvatarInitials name={m.name} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.name}</span>
                  {editing === m.userId ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => savePosition(m.userId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") savePosition(m.userId);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      placeholder={t("team_position_placeholder")}
                      maxLength={60}
                      aria-label={t("team_position")}
                      className="mt-0.5 w-full rounded border border-input bg-background px-1 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  ) : canEdit ? (
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
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      run(() => removeClientMemberAction({ clientId, userId: m.userId }), m.userId)
                    }
                    disabled={busy === m.userId}
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

        {canEdit && candidates.length > 0 && (
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
              {candidates.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={() => run(() => addClientMemberAction({ clientId, userId: c.id }), c.id)}
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

      {/* ── The effect ─────────────────────────────────────────────────── */}
      <div className="border-t border-border/60 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5 shrink-0" aria-hidden />
          {t("access_heading")}
        </p>

        {isPrivate ? (
          <ul className="mt-2 space-y-1">
            {seers.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">{p.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          // The honest answer while the client is not private: membership is
          // not yet what limits sight, and saying otherwise would be the same
          // lie the old panel told, pointing the other way.
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("access_everyone", { count: firmSize })}
          </p>
        )}

        {isPrivate && seers.length === 1 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("access_only_you")}
          </p>
        )}
      </div>
    </div>
  );
}
