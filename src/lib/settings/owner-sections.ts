// Which /settings sub-sections only the firm OWNER may see + edit.
//
// Staff keep full PRODUCT access (clients, engagements, Preview, approve/reject,
// AI) but not firm-admin. Billing and firm-wide document handling are entirely
// owner-only TABS. Within the Account + General tabs, the firm-settings and
// timezone sub-sections are also owner-only (handled inline in settings-form).
//
// UI hiding is defence-in-depth: the server actions + /api routes reject staff
// regardless of what the UI shows.

export type SettingsSectionId =
  | "account"
  | "security"
  | "appearance"
  | "general"
  | "billing"
  | "documents";

export const OWNER_ONLY_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "billing",
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
