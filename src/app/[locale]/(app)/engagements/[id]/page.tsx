import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import { listRequestItems } from "@/lib/db/request-items";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  sendEngagementAction,
  cancelEngagementAction,
  deleteDraftAction,
} from "@/app/actions/engagements";
import { assertLocale } from "@/lib/locale";
import { MagicLinkPanel } from "@/components/engagements/magic-link-panel";
import { ArrowLeft, Send, X, Trash2 } from "lucide-react";

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const engagement = await getEngagement(id);
  if (!engagement) notFound();
  const client = await getClient(engagement.client_id);
  const items = await listRequestItems(engagement.id);

  const t = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");

  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  const portalUrl =
    engagement.magic_token != null
      ? `${baseUrl}/r/${engagement.magic_token}`
      : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-3.5" />
        {t("back")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {engagement.title}
          </h1>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Badge variant={statusVariant(engagement.status)}>
              {tStatus(engagement.status)}
            </Badge>
            {client && (
              <Link
                href={`/clients/${client.id}`}
                className="text-muted-foreground hover:text-foreground"
              >
                {client.display_name}
              </Link>
            )}
            {engagement.due_date && (
              <span className="text-muted-foreground">
                · {t("due", { date: engagement.due_date })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {engagement.status === "draft" && (
            <>
              <form action={sendEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button type="submit" size="sm">
                  <Send className="size-4" />
                  {t("send")}
                </Button>
              </form>
              <form action={deleteDraftAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <input type="hidden" name="__app_locale" value={locale} />
                <Button type="submit" variant="outline" size="sm">
                  <Trash2 className="size-4" />
                  {t("delete_draft")}
                </Button>
              </form>
            </>
          )}
          {(engagement.status === "sent" ||
            engagement.status === "in_progress") && (
            <form action={cancelEngagementAction}>
              <input type="hidden" name="id" value={engagement.id} />
              <Button type="submit" variant="outline" size="sm">
                <X className="size-4" />
                {t("cancel")}
              </Button>
            </form>
          )}
        </div>
      </header>

      {portalUrl && <MagicLinkPanel url={portalUrl} />}

      {engagement.status === "draft" && (
        <Alert>
          <AlertDescription>{t("draft_notice")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("checklist")}{" "}
            <span className="text-muted-foreground font-normal">
              ({items.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("checklist_empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const label =
                  locale === "fr" && item.label_fr
                    ? item.label_fr
                    : item.label;
                return (
                  <li
                    key={item.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{label}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {item.doc_type}
                        {item.required && (
                          <span className="ml-2 text-warning">
                            · {t("required")}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={statusVariant(item.status)}>
                      {tStatus(item.status)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function statusVariant(
  status: string,
):
  | "default"
  | "secondary"
  | "outline"
  | "destructive" {
  if (status === "complete" || status === "approved") return "default";
  if (status === "cancelled" || status === "rejected") return "destructive";
  if (status === "draft" || status === "na") return "outline";
  return "secondary";
}
