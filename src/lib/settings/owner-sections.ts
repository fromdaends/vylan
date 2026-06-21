// Which /settings sub-sections only the firm OWNER may see + edit.
//
// Staff keep full PRODUCT access (clients, engagements, Preview, approve/reject,
// AI) but not firm-admin. Payments (the firm's Vylan subscription, plus client
// payment collection) and firm-wide document handling are entirely owner-only
// TABS. Within the Account + General tabs, the firm-settings and timezone
// sub-sections are also owner-only (handled inline in settings-form).
//
// UI hiding is defence-in-depth: the server actions + /api routes reject staff
// regardless of what the UI shows.

export type SettingsSectionId =
  | "account"
  | "security"
  | "appearance"
  | "general"
  | "payments"
  | "integrations"
  | "documents";

// NOTE: "integrations" is NOT owner-only — any firm member may VIEW the
// QuickBooks connection + read its data. Connect/disconnect are gated to owners
// inside IntegrationsSection (isOwner), not by hiding the whole tab.
export const OWNER_ONLY_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "payments",
  "documents",
];

export function isOwnerOnlySettingsSection(id: string): boolean {
  return (OWNER_ONLY_SETTINGS_SECTIONS as readonly string[]).includes(id);
}

// The sections a user of the given role should see in the settings sub-nav.
export function visibleSettingsSections(
  all: readonly SettingsSectionId[],
  isOwner: boolean,
): SettingsSectionId[] {
  return isOwner
    ? [...all]
    : all.filter((id) => !isOwnerOnlySettingsSection(id));
}
