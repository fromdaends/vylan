import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand";

export async function PublicFooter() {
  const t = await getTranslations("Footer");
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card/30 mt-auto">
      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <div>
          © {year} {brand.name}.{" "}
          <span className="text-muted-foreground/70">{t("based_in")}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/pricing" className="hover:text-foreground">
            {t("pricing")}
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            {t("terms")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t("privacy")}
          </Link>
          <a
            href={`mailto:${brand.supportEmail}`}
            className="hover:text-foreground"
          >
            {t("contact")}
          </a>
        </nav>
      </div>
    </footer>
  );
}
