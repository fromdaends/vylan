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
import { Check, Eye } from "lucide-react";
import { ClientTeamEditor } from "@/components/clients/client-team-editor";
import {
  addClientMemberAction,
  removeClientMemberAction,
} from "@/app/actions/client-members";

import type { TeamRow as Member } from "@/components/clients/client-team-editor";
type Person = { id: string; name: string };

// `isPrivate` and `firmSize` are deliberately gone. They existed to render the
// "everyone at your firm can see this" case, and since 1240 there is no such
// case — the list is the answer whether or not a client is marked private.
// Leaving them as ignored props would have left the next reader thinking
// privacy still branches here.
export function ClientAccess({
  clientId,
  members,
  owners,
  assignee,
  candidates,
  canEdit,
}: {
  clientId: string;
  members: Member[];
  /** Firm owners — they see every client, membership or not. */
  owners: Person[];
  /** The person the client is assigned to, if any. */
  assignee: Person | null;
  candidates: Person[];
  canEdit: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

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
      <ClientTeamEditor
        rows={members}
        candidates={candidates}
        canEdit={canEdit}
        busyId={busy}
        emptyLabel={t("team_empty")}
        mode="live"
        onAdd={(userId) => run(() => addClientMemberAction({ clientId, userId }), userId)}
        onRemove={(userId) =>
          run(() => removeClientMemberAction({ clientId, userId }), userId)
        }
        onPosition={(userId, position) =>
          run(() => addClientMemberAction({ clientId, userId, position }), userId)
        }
      />

      {/* ── The effect ─────────────────────────────────────────────────── */}
      <div className="border-t border-border/60 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5 shrink-0" aria-hidden />
          {t("access_heading")}
        </p>

        {/* One list, whether or not the client is marked private. Since 1240
            the list IS the answer — "not private" no longer means "the whole
            firm" — so branching on it here would print two different truths
            for the same state. */}
        <ul className="mt-2 space-y-1">
          {seers.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="shrink-0 text-muted-foreground">{p.reason}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("access_everyone")}
        </p>

        {seers.length === 1 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("access_only_you")}
          </p>
        )}
      </div>
    </div>
  );
}
