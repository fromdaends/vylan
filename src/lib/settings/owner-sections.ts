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
  | "automation"
  | "integrations"
  | "documents"
  | "assistant";

// NOTE: "integrations" is NOT owner-only — any firm member may VIEW the
// QuickBooks connection + read its data. Connect/disconnect are gated to owners
// inside IntegrationsSection (isOwner), not by hiding the whole tab.
export const OWNER_ONLY_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "payments",
  "documents",
  // Whether the AI may act without a human confirming is a firm-wide safety
  // policy — owner-only, like document handling.
  "assistant",
  // Firm-wide automations (invoice automation default, more to come) change
  // what the product does on its own — owner-only, like payments.
  "automation",
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
