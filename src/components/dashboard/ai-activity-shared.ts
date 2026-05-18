// Pure utilities shared between the server-rendered preview line on
// the dashboard's AI activity section header and the client-rendered
// list inside it. Accepts any translator function so it works with
// both `getTranslations` (server) and `useTranslations` (client).

export type Translator = (key: string) => string;

export function aiActivityShortLabel(action: string, t: Translator): string {
  switch (action) {
    case "ai_classified":
      return t("ai_action_classified");
    case "ai_auto_rejected":
      return t("ai_action_auto_rejected");
    case "ai_escalated_to_accountant":
      return t("ai_action_escalated");
    case "ai_quality_flagged":
      return t("ai_action_quality_flagged");
    case "ai_rejection_overridden":
      return t("ai_action_override");
    default:
      return action;
  }
}

export function aiActionTone(action: string): string {
  switch (action) {
    case "ai_auto_rejected":
    case "ai_escalated_to_accountant":
      return "text-warning";
    case "ai_rejection_overridden":
      return "text-success";
    default:
      return "text-primary";
  }
}
