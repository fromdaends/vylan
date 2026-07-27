import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import {
  getFilingPreviewSample,
  getFirmFilingSettings,
  getFirmStorageConnection,
  getStorageConnectionRootLink,
} from "@/lib/db/filing";
import { ProviderGrid } from "@/components/filing/provider-grid";
import { FilingSettingsForm } from "@/components/filing/filing-settings-form";
import { FilingStatusToasts } from "@/components/filing/provider-card-actions";
import { isGoogleFilingConfigured } from "@/lib/filing/google/oauth";
import { isMicrosoftFilingConfigured } from "@/lib/filing/microsoft/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";

// Live connection + settings state — never serve a cached "Not connected".
export const dynamic = "force-dynamic";

// Document filing — ONE feature page for all four storage providers: connect
// cards up top, then the firm's folder-structure + naming settings with the
// live preview. Providers are connectors behind one shared engine, so their
// settings are shared — this page is where that fact is visible.
export default async function FilingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Filing");

  const [firm, user, settings, connection] = await Promise.all([
    getCurrentFirm(),
    getCurrentUser(),
    getFirmFilingSettings(),
    getFirmStorageConnection(),
  ]);
  const sample = await getFilingPreviewSample(firm?.name ?? "—");
  // Root-folder link for the connected card (provider_config is server-only;
  // this display read runs AFTER the RLS-scoped read proved the row is ours).
  const rootLink =
    connection?.status === "active"
      ? await getStorageConnectionRootLink(connection.id)
      : null;

  // Until the firm saves filing settings, default the FOLDER LANGUAGE to the
  // firm's own default locale — a French-default firm should see French
  // category folders in the preview out of the box, not flip a switch first.
  const language = settings.saved
    ? settings.language
    : firm?.locale_default === "fr"
      ? "fr"
      : "en";

  return (
    <div className="mx-auto max-w-4xl animate-in-fade">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("page_title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          {t("page_subtitle")}
        </p>
      </header>

      <section aria-labelledby="filing-connect">
        <h2
          id="filing-connect"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("connect_section")}
        </h2>
        <div className="mt-3">
          <ProviderGrid
            connection={connection}
            rootLink={rootLink}
            isOwner={user?.role === "owner"}
            configured={{
              google_drive:
                isGoogleFilingConfigured() &&
                (process.env.NODE_ENV !== "production" ||
                  isStorageTokenEncryptionConfigured()),
              microsoft:
                isMicrosoftFilingConfigured() &&
                (process.env.NODE_ENV !== "production" ||
                  isStorageTokenEncryptionConfigured()),
            }}
          />
        </div>
        {/* Where files land: the app-created "Vylan" folder the firm can move
            anywhere in their chosen storage. */}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t("root_hint")}
        </p>
        {/* Data-residency honesty: Vylan hosts in Canada; the firm's storage
            may not be. One plain sentence, the founder's call. */}
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t("residency_note")}
        </p>
      </section>
      <FilingStatusToasts />

      <section aria-labelledby="filing-settings" className="mt-10 border-t border-border/60 pt-8">
        <h2
          id="filing-settings"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("settings_section")}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("settings_intro")}
        </p>
        <div className="mt-5">
          <FilingSettingsForm
            initial={{
              folderTemplate: settings.folderTemplate,
              nameTemplate: settings.nameTemplate,
              language,
              autoFileOnComplete: settings.autoFileOnComplete,
            }}
            sample={sample.tokenContext}
            yearlessSample={sample.yearlessContext}
            sampleIsReal={sample.fromRealDocument}
            isOwner={user?.role === "owner"}
            available={settings.available}
          />
        </div>
      </section>
    </div>
  );
}
