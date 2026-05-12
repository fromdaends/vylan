import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getClient } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
import { ArrowLeft, Plus } from "lucide-react";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const client = await getClient(id);
  if (!client) notFound();

  const engagements = await listEngagements({ client_id: id });
  const t = await getTranslations("Clients");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/clients"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="size-3.5" />
          {t("back_to_list")}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.display_name}
          </h1>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Badge variant="secondary">
              {client.type === "individual"
                ? t("type_individual")
                : t("type_business")}
            </Badge>
            {client.archived_at ? (
              <Badge variant="outline">{t("archived")}</Badge>
            ) : (
              <Badge>{t("active")}</Badge>
            )}
            <span className="text-muted-foreground font-mono text-xs">
              {client.locale.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ClientFormDialog mode="edit" locale={locale} client={client} />
          {client.archived_at ? (
            <form action={restoreClientAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("restore")}
              </Button>
            </form>
          ) : (
            <form action={archiveClientAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("archive")}
              </Button>
            </form>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("contact_info")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <DetailRow label={t("col_email")} value={client.email} />
            <DetailRow label={t("col_phone")} value={client.phone} mono />
            <DetailRow
              label={t("field_external_ref")}
              value={client.external_ref}
              mono
            />
            <DetailRow label={t("field_notes")} value={client.notes} wide />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {t("engagements")}{" "}
            <span className="text-muted-foreground font-normal">
              ({engagements.length})
            </span>
          </CardTitle>
          {!client.archived_at && (
            <Link href={`/engagements/new?client=${client.id}`}>
              <Button size="sm">
                <Plus className="size-4" />
                {tEng("new")}
              </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {engagements.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("engagements_empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {engagements.map((e) => (
                <li key={e.id} className="py-3">
                  <Link
                    href={`/engagements/${e.id}`}
                    className="flex items-center justify-between gap-3 hover:text-foreground"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {e.type.toUpperCase()}
                        {e.due_date && ` · ${formatDate(e.due_date, locale, "medium")}`}
                      </div>
                    </div>
                    <Badge variant={statusVariant(e.status)}>
                      {tStatus(e.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (value ? "" : "text-muted-foreground/60") +
          " mt-0.5 whitespace-pre-wrap"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "draft") return "outline";
  return "secondary";
}
