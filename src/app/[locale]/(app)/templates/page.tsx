import { getTranslations, setRequestLocale } from "next-intl/server";
import { listTemplates } from "@/lib/db/templates";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  cloneTemplateAction,
  deleteTemplateAction,
} from "@/app/actions/templates";
import { assertLocale } from "@/lib/locale";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const templates = await listTemplates();
  const builtIn = templates.filter((t) => t.firm_id == null);
  const firm = templates.filter((t) => t.firm_id != null);

  const t = await getTranslations("Templates");
  const tc = await getTranslations("Common");
  void tc;

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t("section_builtin")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {builtIn.map((tmpl) => (
            <Card key={tmpl.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{tmpl.name}</CardTitle>
                  <Badge variant="secondary" className="mt-2 text-xs">
                    {tmpl.type.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {tmpl.items.length} {t("items_count")}
                </p>
                <div className="flex items-center gap-2">
                  <form action={cloneTemplateAction}>
                    <input type="hidden" name="id" value={tmpl.id} />
                    <Button type="submit" size="sm" variant="outline">
                      {t("clone")}
                    </Button>
                  </form>
                  <Link href={`/engagements/new?template=${tmpl.id}`}>
                    <Button size="sm" variant="ghost">
                      {t("use_in_new")}
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t("section_firm")}
        </h2>
        {firm.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t("firm_empty")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {firm.map((tmpl) => (
              <Card key={tmpl.id}>
                <CardHeader>
                  <CardTitle className="text-base">{tmpl.name}</CardTitle>
                  <Badge variant="outline" className="mt-2 text-xs w-fit">
                    {tmpl.type.toUpperCase()}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {tmpl.items.length} {t("items_count")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Link href={`/templates/${tmpl.id}`}>
                      <Button size="sm" variant="outline">
                        {t("edit")}
                      </Button>
                    </Link>
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={tmpl.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t("delete")}
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
