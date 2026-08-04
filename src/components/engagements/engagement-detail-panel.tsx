"use client";

// One engagement, opened — the sidebar the tasks list already had.
//
// Founder, pointing at the task drawer: "you see this sidebar view for tasks.
// do the same thing for engagements. its lacking."
//
// Same split, same reason as the task panel: a list is SCANNED and a row is
// READ. The engagements list answers "is anything waiting on me"; this answers
// "what is this job, who is on it, and what is left" without spending a page
// navigation to find out.
//
// ── WHAT IS EDITABLE HERE, AND WHY THAT IS LESS THAN THE TASK PANEL ────────
//
// Every control in here is backed by a server action that ALREADY EXISTS:
// reassign, send, mark complete, reopen. The task panel also edits its title,
// due date, priority and notes — an engagement has no update action for any of
// those, and inventing four write paths for a drawer is how a second, quieter
// way of editing an engagement gets built beside the real one.
//
// So the rule this panel follows: it EDITS what the app can already edit, and
// READS the rest, with one prominent door to the full screen where the rest
// lives. A control that looks live and silently does nothing is the dead
// button this codebase keeps deleting.
//
// ── NO SERVER STATE OF ITS OWN ─────────────────────────────────────────────
//
// Like the task panel, this holds none: it is handed a row and callbacks, and
// the list owns the write. Two components writing the same engagement is how a
// panel and a row start disagreeing about whether something is complete.

import { ExternalLink, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { AgreementChip } from "@/components/engagements/agreement-chip";
import {
  Field,
  PersonCheckRow,
} from "@/components/engagements/detail-panel-bits";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { agreementStatusForRow } from "@/lib/engagements/agreement";
import { formatDate, type AppLocale } from "@/lib/format";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

type Person = { id: string; name: string };

export function EngagementDetailPanel({
  row,
  members,
  canEdit,
  locale,
  onClose,
  onReassign,
}: {
  /** Null when nothing is open. The sheet stays mounted either way. */
  row: WorklistRow | null;
  members: Person[];
  canEdit: boolean;
  locale: AppLocale;
  onClose: () => void;
  /** null = unassign. The LIST does the optimistic update and the write. */
  onReassign: (assigneeId: string | null) => void;
}) {
  return (
    <Sheet open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {row && (
          <PanelBody
            key={row.id}
            row={row}
            members={members}
            canEdit={canEdit}
            locale={locale}
            onClose={onClose}
            onReassign={onReassign}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({
  row,
  members,
  canEdit,
  locale,
  onClose,
  onReassign,
}: {
  row: WorklistRow;
  members: Person[];
  canEdit: boolean;
  locale: AppLocale;
  onClose: () => void;
  onReassign: (assigneeId: string | null) => void;
}) {
  const t = useTranslations("Engagements");

  // The SAME resolver and the SAME chip the list's Status column uses. A panel
  // that computed its own status could disagree with the row two inches to its
  // left, which is precisely the drift the agreement-status remodel removed.
  const status = agreementStatusForRow(row);

  // What was SOLD. Priced lines first, falling back to the engagement's `type`
  // for anything created before #1274 — the same order the list's Service
  // items column uses, so the two never disagree.
  const services =
    row.serviceNames && row.serviceNames.length > 0 ? row.serviceNames : [];

  const date = (iso: string | null | undefined) =>
    iso ? formatDate(iso, locale) : "—";

  return (
    <>
      <SheetHeader className="space-y-1.5">
        {/* ⚠️ pr-7 IS LOAD-BEARING. SheetContent draws its own close button
            absolutely positioned in the top-right corner, so anything this row
            puts at its end lands UNDERNEATH it — the status chip was half
            hidden behind the X on the deployed page, which no test could have
            caught. The padding reserves the corner the sheet already owns. */}
        <div className="flex items-start justify-between gap-3 pr-7">
          <SheetTitle className="min-w-0 text-lg font-semibold tracking-tight">
            {row.title}
          </SheetTitle>
          <AgreementChip status={status} />
        </div>
        <SheetDescription className="text-xs">
          <Link
            href={`/clients/${row.clientId}`}
            className="hover:text-foreground hover:underline"
          >
            {row.clientName}
          </Link>
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
        {/* First control, full width, exactly as the task panel opens with its
            "open the task's screen" button. An engagement's page holds the
            tabs, the documents and the invoice — the panel must never be a
            dead end on the way there. */}
        <Button asChild variant="secondary" className="w-full justify-between">
          <Link href={`/engagements/${row.id}`} onClick={onClose}>
            {t("open_engagement")}
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        </Button>

        {/* WORK AS A COUNT, not an adjective. The agreement-status remodel's
            central finding: a job with six parallel tasks cannot be described
            by one word, but "3 of 6 done" stays true when a seventh starts. */}
        <Field label={t("work_progress", { done: row.tasksDone, total: row.tasksTotal })}>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={row.tasksTotal}
            aria-valuenow={row.tasksDone}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{
                width: `${row.tasksTotal > 0 ? (row.tasksDone / row.tasksTotal) * 100 : 0}%`,
              }}
            />
          </div>
        </Field>

        <Field label={t("assigned_to")}>
          <div className="flex flex-col gap-0.5" role="radiogroup">
            {members.map((m) => (
              <PersonCheckRow
                key={m.id}
                name={m.name}
                single
                on={row.assigneeUserId === m.id}
                disabled={!canEdit}
                // Ticking the person already on it UNASSIGNS. Without that a
                // single-select is a one-way door: you could hand the job over
                // but never take the name off it.
                onClick={() =>
                  onReassign(row.assigneeUserId === m.id ? null : m.id)
                }
              />
            ))}
            {!row.assigneeUserId && (
              <p className="flex items-center gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
                <UserPlus className="size-3.5" aria-hidden />
                {t("work_unassigned")}
              </p>
            )}
          </div>
        </Field>

        <Field label={t("details_dates")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("details_sent")}</dt>
            <dd>{date(row.startedAt)}</dd>
            <dt className="text-muted-foreground">{t("details_due")}</dt>
            <dd>{date(row.dueDate)}</dd>
          </dl>
        </Field>

        <Field label={t("details_services")}>
          {services.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {services.map((name, i) => (
                <li key={`${name}-${i}`}>{name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("details_no_services")}
            </p>
          )}
        </Field>
      </div>
    </>
  );
}
