// Locale-aware 404 — used when a path inside /[locale]/... doesn't match.
// Wrapped by the locale layout so we get the firm header etc when signed in.

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";

export default async function LocaleNotFound() {
  const t = await getTranslations("Errors");
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-24">
      <div className="max-w-md text-center space-y-4">
        <div className="text-xs font-mono tracking-widest text-muted-foreground">
          404
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("not_found")}
        </h1>
        <p className="text-muted-foreground">{t("not_found_body")}</p>
        <div className="pt-4">
          <Link href="/">
            <Button>{t("back_home")}</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
