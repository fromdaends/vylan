import { getTranslations } from "next-intl/server";
import type { ActivityEntry } from "@/lib/db/activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative, type AppLocale } from "@/lib/format";

export async function ActivityTimeline({
  entries,
  locale,
}: {
  entries: ActivityEntry[];
  locale: AppLocale;
}) {
  const t = await getTranslations("Activity");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("empty")}</p>
        ) : (
          <ol className="space-y-3 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span
                  className={
                    "mt-1.5 size-1.5 rounded-full shrink-0 " +
                    actorDot(e.actor_type)
                  }
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="leading-snug">{describe(e, t)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatRelative(e.created_at, locale)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function actorDot(actor: ActivityEntry["actor_type"]): string {
  if (actor === "client") return "bg-success";
  if (actor === "user") return "bg-primary";
  return "bg-muted-foreground";
}

function describe(
  entry: ActivityEntry,
  t: Awaited<ReturnType<typeof getTranslations<"Activity">>>,
): string {
  const meta = entry.metadata as Record<string, string | undefined>;
  switch (entry.action) {
    case "client_uploaded":
      return t("client_uploaded", { filename: meta.filename ?? "—" });
    case "client_marked_na":
      return t("client_marked_na");
    case "client_undid_na":
      return t("client_undid_na");
    case "approve_item":
      return t("approve_item");
    case "reject_item":
      return t("reject_item", { reason: meta.reason ?? "—" });
    case "reopen_item":
      return t("reopen_item");
    case "add_item":
      return t("add_item", { label: meta.label ?? "—" });
    case "remove_item":
      return t("remove_item");
    case "manual_reminder":
      return t("manual_reminder");
    case "reminder_fired":
      return t("reminder_fired", { tone: meta.tone ?? "—" });
    case "reminders_paused":
      return t("reminders_paused");
    case "reminders_resumed":
      return t("reminders_resumed");
    case "cancel_engagement":
      return t("cancel_engagement");
    case "complete_engagement":
      return t("complete_engagement");
    case "reopen_engagement":
      return t("reopen_engagement");
    case "ai_classified": {
      const conf =
        typeof meta.confidence === "number"
          ? `${Math.round((meta.confidence as number) * 100)}%`
          : "—";
      return t("ai_classified", {
        document_type: String(meta.document_type ?? "?"),
        confidence: conf,
      });
    }
    default:
      return entry.action;
  }
}
