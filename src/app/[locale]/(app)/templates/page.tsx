import { getTranslations, setRequestLocale } from "next-intl/server";
import { listTemplates } from "@/lib/db/templates";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  cloneTemplateAction,
  deleteTemplateAction,
} from "@/app/actions/templates";
import { assertLocale } from "@/lib/locale";
import { FileText, ArrowUpRight } from "lucide-react";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const templates = await listTemplates();
  const builtIn = templates.filter((tmpl) => tmpl.firm_id == null);
  const firm = templates.filter((tmpl) => tmpl.firm_id != null);

  const t = await getTranslations("Templates");

  return (
    <div className="space-y-10 max-w-3xl">
      <header className="animate-in-up">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      <Section title={t("section_builtin")} count={builtIn.length}>
        <TemplateList>
          {builtIn.map((tmpl) => (
            <TemplateRow
              key={tmpl.id}
              name={tmpl.name}
              type={tmpl.type}
              itemsCount={tmpl.items.length}
              itemsLabel={t("items_count")}
            >
              <form action={cloneTemplateAction}>
                <input type="hidden" name="id" value={tmpl.id} />
                <Button type="submit" size="sm" variant="ghost">
                  {t("clone")}
                </Button>
              </form>
              <Link href={`/engagements/new?template=${tmpl.id}`}>
                <Button size="sm" variant="ghost">
                  {t("use_in_new")}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </TemplateRow>
          ))}
        </TemplateList>
      </Section>

      <Section title={t("section_firm")} count={firm.length}>
        {firm.length === 0 ? (
          <EmptyRow>{t("firm_empty")}</EmptyRow>
        ) : (
          <TemplateList>
            {firm.map((tmpl) => (
              <TemplateRow
                key={tmpl.id}
                name={tmpl.name}
                type={tmpl.type}
                itemsCount={tmpl.items.length}
                itemsLabel={t("items_count")}
              >
                <Link href={`/templates/${tmpl.id}`}>
                  <Button size="sm" variant="ghost">
                    {t("edit")}
                  </Button>
                </Link>
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="id" value={tmpl.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {t("delete")}
                  </Button>
                </form>
              </TemplateRow>
            ))}
          </TemplateList>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-border/60 pb-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>
        <span className="text-xs font-mono tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function TemplateList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="rounded-xl border border-border bg-card divide-y divide-border/60 overflow-hidden">
      {children}
    </ul>
  );
}

function TemplateRow({
  name,
  type,
  itemsCount,
  itemsLabel,
  children,
}: {
  name: string;
  type: string;
  itemsCount: number;
  itemsLabel: string;
  children: React.ReactNode;
}) {
  return (
    <li className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary/40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-accent/10 group-hover:text-accent shrink-0">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono tabular-nums">
            <span className="uppercase tracking-wider">{type}</span>
            <span className="mx-2 text-border">·</span>
            {itemsCount} {itemsLabel}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">{children}</div>
    </li>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-5 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
