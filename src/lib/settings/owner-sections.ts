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
  | "team"
  | "payments"
  | "automation"
  | "integrations"
  | "documents"
  | "assistant";

// NOTE: "automation" is NOT owner-only either. The tab holds two kinds of
// thing: firm-wide automation SETTINGS (invoice + reminder defaults), which
// stay owner-gated inline in settings-form, and the list of repeating
// schedules, which every member may see — staff receive the engagements
// those schedules create, so hiding the schedule while showing its output is
// the worse failure. Row-level privacy is enforced in the database.
//
// NOTE: "integrations" is NOT owner-only — any firm member may VIEW the
// QuickBooks connection + read its data. Connect/disconnect are gated to owners
// inside IntegrationsSection (isOwner), not by hiding the whole tab.
export const OWNER_ONLY_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  // Firm-wide team policy (privacy defaults, assignment emails, sign-off) —
  // owner-only, and the tab only appears in team mode (gated in settings-form).
  "team",
  "payments",
  "documents",
  // Whether the AI may act without a human confirming is a firm-wide safety
  // policy — owner-only, like document handling.
  "assistant",
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
