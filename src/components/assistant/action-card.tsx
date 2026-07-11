"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDate, type AppLocale } from "@/lib/format";
import type { ActionCardData, ActionCardStatus } from "./thread";

// The propose-and-confirm card: shows EXACTLY what the assistant wants to do
// and executes only on Confirm (POST /api/engagement-chat/confirm with the
// card's browser-held token). Confirm/Cancel never touch the message rate
// limit — no model call happens here.

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  approve_document: CheckCircle2,
  reject_document: XCircle,
  send_reminder: Bell,
  add_checklist_item: Plus,
  edit_checklist_item: Pencil,
  remove_checklist_item: Trash2,
  change_due_date: Calendar,
  change_assignee: Users,
};

export function ActionCard({
  card,
  locale,
  onResolved,
}: {
  card: ActionCardData;
  locale: AppLocale;
  onResolved: (id: string, status: ActionCardStatus, error: string | null) => void;
}) {
  const t = useTranslations("Assistant");
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  // Expiry is clocked in an effect (never during render): the card flips to
  // "expired" on its own the moment the window closes.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (card.status !== "proposed") return;
    const ms = new Date(card.expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      const frame = requestAnimationFrame(() => setExpired(true));
      return () => cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.min(ms, 2 ** 31 - 1),
    );
    return () => window.clearTimeout(timer);
  }, [card.status, card.expiresAt]);

  const status: ActionCardStatus =
    expired && card.status === "proposed" ? "expired" : card.status;
  const actionable = status === "proposed" && card.token !== null;

  const decide = async (decision: "confirm" | "cancel") => {
    if (!card.token || busy) return;
    setBusy(decision);
    try {
      const res = await fetch("/api/engagement-chat/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId: card.id,
          token: card.token,
          decision,
        }),
      });
      if (!res.ok) {
        // Terminal route errors (expired token cleanup happens server-side
        // too); map to a failed card state so the user isn't left hanging.
        let code = "execute_failed";
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error === "chat_not_ready") code = "not_ready";
          else if (body.error) code = body.error;
        } catch {
          // keep default
        }
        onResolved(card.id, "failed", code);
        return;
      }
      const body = (await res.json()) as {
        status: ActionCardStatus;
        error: string | null;
      };
      onResolved(card.id, body.status, body.error);
    } catch {
      onResolved(card.id, "failed", "network");
    } finally {
      setBusy(null);
    }
  };

  const Icon = TYPE_ICONS[card.type] ?? CheckCircle2;
  const destructive =
    card.type === "reject_document" || card.type === "remove_checklist_item";

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5",
        status === "proposed"
          ? "border-border/70 bg-background/50"
          : "border-border/50 bg-background/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
            destructive
              ? "bg-destructive/10 text-destructive"
              : "bg-accent/10 text-accent",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">
            {t(`action_title_${card.type}`)}
          </div>
          <CardBody card={card} locale={locale} />
        </div>
        <StatusChip status={status} />
      </div>

      {status === "failed" && (
        <p className="mt-2 pl-10 text-xs text-destructive leading-snug">
          {failureText(t, card.error)}
        </p>
      )}

      {actionable && (
        <div className="mt-3 flex items-center justify-end gap-2 pl-10">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void decide("cancel")}
          >
            {busy === "cancel" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <X className="size-3.5" aria-hidden />
            )}
            {t("action_cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={busy !== null}
            onClick={() => void decide("confirm")}
          >
            {busy === "confirm" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            {t("action_confirm")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: ActionCardStatus }) {
  const t = useTranslations("Assistant");
  if (status === "proposed") return null;
  const style =
    status === "confirmed"
      ? "bg-success/10 text-success"
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  const label =
    status === "confirming"
      ? t("action_status_confirmed")
      : t(`action_status_${status}`);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        style,
      )}
    >
      {label}
    </span>
  );
}

type Translator = ReturnType<typeof useTranslations<"Assistant">>;

function failureText(t: Translator, code: string | null): string {
  switch (code) {
    case "reminded_recently":
      return t("action_error_reminded_recently");
    case "state_changed":
    case "already_resolved":
      return t("action_error_state_changed");
    case "network":
      return t("action_error_network");
    default:
      return t("action_error_failed");
  }
}

// The per-type detail lines — exactly what will happen, in the user's words.
function CardBody({
  card,
  locale,
}: {
  card: ActionCardData;
  locale: AppLocale;
}) {
  const t = useTranslations("Assistant");
  const p = card.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);

  const lines: React.ReactNode[] = [];
  switch (card.type) {
    case "approve_document": {
      lines.push(<Line key="f">{str("file_name")}</Line>);
      if (str("item_label")) {
        lines.push(
          <Line key="i" muted>
            {t("action_item_context", { label: str("item_label") ?? "" })}
          </Line>,
        );
      }
      break;
    }
    case "reject_document": {
      lines.push(<Line key="f">{str("file_name")}</Line>);
      lines.push(
        <Line key="r">
          {t("action_reject_reason", { reason: str("reason") ?? "" })}
        </Line>,
      );
      lines.push(
        <Line key="n" muted>
          {t("action_reject_note")}
        </Line>,
      );
      break;
    }
    case "send_reminder": {
      lines.push(
        <Line key="c">
          {t("action_reminder_to", {
            name: str("client_name") ?? str("client_email") ?? "",
          })}
        </Line>,
      );
      break;
    }
    case "add_checklist_item": {
      lines.push(<Line key="l">{str("label")}</Line>);
      lines.push(
        <Line key="m" muted>
          {t("action_add_item_meta", {
            type: str("doc_type") ?? "other",
            required:
              p.required === false
                ? t("action_optional")
                : t("action_required"),
          })}
        </Line>,
      );
      break;
    }
    case "edit_checklist_item": {
      lines.push(<Line key="l">{str("item_label")}</Line>);
      const changes = (p.changes ?? {}) as Record<string, unknown>;
      if (typeof changes.new_label === "string") {
        lines.push(
          <Line key="nl">
            {t("action_change_label", { value: changes.new_label })}
          </Line>,
        );
      }
      if (typeof changes.required === "boolean") {
        lines.push(
          <Line key="rq">
            {changes.required
              ? t("action_change_required_on")
              : t("action_change_required_off")}
          </Line>,
        );
      }
      if (typeof changes.doc_type === "string") {
        lines.push(
          <Line key="dt">
            {t("action_change_doc_type", { value: changes.doc_type })}
          </Line>,
        );
      }
      break;
    }
    case "remove_checklist_item": {
      lines.push(<Line key="l">{str("item_label")}</Line>);
      const count = typeof p.files_count === "number" ? p.files_count : 0;
      if (count > 0) {
        lines.push(
          <Line key="w">
            <span className="text-destructive">
              {t("action_remove_files_warning", { count })}
            </span>
          </Line>,
        );
      }
      break;
    }
    case "change_due_date": {
      const from = str("from");
      const to = str("to");
      lines.push(
        <Line key="d">
          {to
            ? t("action_due_date_to", {
                date: formatDate(to, locale, "medium"),
              })
            : t("action_due_date_clear")}
        </Line>,
      );
      if (from) {
        lines.push(
          <Line key="f" muted>
            {t("action_due_date_from", {
              date: formatDate(from, locale, "medium"),
            })}
          </Line>,
        );
      }
      break;
    }
    case "change_assignee": {
      lines.push(
        <Line key="t">
          {t("action_assignee_to", { name: str("member_name") ?? "" })}
        </Line>,
      );
      if (str("from_name")) {
        lines.push(
          <Line key="f" muted>
            {t("action_assignee_from", { name: str("from_name") ?? "" })}
          </Line>,
        );
      }
      break;
    }
    default:
      break;
  }

  return <div className="mt-1 space-y-0.5">{lines}</div>;
}

function Line({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <p
      className={cn(
        "text-sm leading-snug break-words",
        muted ? "text-xs text-muted-foreground" : "text-foreground/90",
      )}
    >
      {children}
    </p>
  );
}
