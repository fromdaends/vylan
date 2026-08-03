import { getTranslations } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
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
import { isDropboxFilingConfigured } from "@/lib/filing/dropbox/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";

// Document filing — ONE panel for all four storage providers: connect cards up
// top, then the firm's folder-structure + naming settings with the live preview.
// Providers are connectors behind one shared engine, so their settings are
// shared, and this is where that fact is visible.
//
// Extracted from the old standalone /integrations/filing page so the Vylan hub
// can render it as a tab. The page-level heading now belongs to the hub, so this
// starts at the first section.
export async function FilingPanel() {
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
    <>
      <section aria-labelledby="filing-connect">
        <h2
          id="filing-connect"
          className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground"
        >
          {t("connect_section")}
        </h2>
        <div className="mt-3">
          <ProviderGrid
            connection={connection}
            rootLink={rootLink}
            isOwner={can(user, "integrations.manage")}
            configured={{
              google_drive:
                isGoogleFilingConfigured() &&
                (process.env.NODE_ENV !== "production" ||
                  isStorageTokenEncryptionConfigured()),
              microsoft:
                isMicrosoftFilingConfigured() &&
                (process.env.NODE_ENV !== "production" ||
                  isStorageTokenEncryptionConfigured()),
              dropbox:
                isDropboxFilingConfigured() &&
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

      <section
        aria-labelledby="filing-settings"
        className="mt-8"
      >
        <h2
          id="filing-settings"
          className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground"
        >
          {t("settings_section")}
        </h2>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          {t("settings_intro")}
        </p>
        <div className="mt-4">
          <FilingSettingsForm
            initial={{
              folderTemplate: settings.folderTemplate,
              nameTemplate: settings.nameTemplate,
              language,
              autoFileOnComplete: settings.autoFileOnComplete,
              fileRejected: settings.fileRejected,
            }}
            sample={sample.tokenContext}
            yearlessSample={sample.yearlessContext}
            sampleIsReal={sample.fromRealDocument}
            isOwner={can(user, "integrations.manage")}
            available={settings.available}
          />
        </div>
      </section>
    </>
  );
}
