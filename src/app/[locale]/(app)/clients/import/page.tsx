import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { CsvImportClient } from "./csv-import-client";
import { BookkeepingImportButtons } from "./bookkeeping-import-buttons";
import { BookkeepingImportReview } from "./bookkeeping-import-review";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isQuickbooksConfigured } from "@/lib/quickbooks/client";
import { isXeroConfigured } from "@/lib/xero/client";
import { getClientImportSession } from "@/lib/db/client-import";
import { listClients } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";

// Fresh state on every visit: an import session or callback flag must never be
// served from cache.
export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session?: string; bkimport?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { session: sessionParam, bkimport } = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Clients");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  // A staged bookkeeping import to review? (RLS-scoped read — a session id from
  // another firm, an expired one, or a consumed one all come back null.)
  const session = sessionParam
    ? await getClientImportSession(sessionParam)
    : null;
  // Existing client names (normalized) so the review greys out duplicates.
  const existingNames = session
    ? (await listClients({})).map((c) => c.display_name.trim().toLowerCase())
    : [];
  const firm = session ? await getCurrentFirm() : null;
  const defaultClientLocale =
    firm?.locale_default === "en" ? ("en" as const) : ("fr" as const);

  // Callback status when the OAuth import came back without a usable session.
  const bkError =
    sessionParam && !session
      ? t("bk_import_session_gone")
      : bkimport === "error"
        ? t("bk_import_error")
        : bkimport === "empty"
          ? t("bk_import_empty")
          : bkimport === "setup"
            ? t("bk_import_setup")
            : bkimport === "denied"
              ? t("bk_import_denied")
              : null;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_clients"), href: "/clients" },
          { label: t("import_title") },
        ]}
      />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("import_title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("import_subtitle")}
        </p>
      </header>

      {bkError && (
        <Alert>
          <AlertDescription>{bkError}</AlertDescription>
        </Alert>
      )}

      {session ? (
        <BookkeepingImportReview
          sessionId={session.id}
          sourceName={session.sourceName}
          candidates={session.candidates}
          existingNames={existingNames}
          defaultClientLocale={defaultClientLocale}
          locale={locale}
        />
      ) : (
        <>
          {/* Import straight from the firm's own books — the fastest onboarding
              path. The CSV flow below stays for everything else. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t("bk_import_title")}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("bk_import_hint")}
            </p>
            <BookkeepingImportButtons
              qboEnabled={isQuickbooksConfigured()}
              xeroEnabled={isXeroConfigured()}
            />
          </section>
          <CsvImportClient locale={locale} />
        </>
      )}
    </div>
  );
}
