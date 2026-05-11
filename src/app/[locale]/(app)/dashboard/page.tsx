import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { Card, CardContent } from "@/components/ui/card";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const firm = await getCurrentFirm();
  const t = await getTranslations("App");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("dashboard_title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{firm?.name}</p>
      </header>
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {t("dashboard_empty")}
        </CardContent>
      </Card>
    </div>
  );
}
