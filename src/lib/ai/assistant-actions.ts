// The engagement assistant's ACTION layer (send reminders, approve / reject
// documents, add / edit / remove checklist items, change due date, reassign)
// is DORMANT by default.
//
// The popup "Vylan" AI is READ-ONLY: it looks things up and summarizes, but it
// never changes client data. The propose-and-confirm plumbing
// (src/lib/engagement-chat/*, POST /api/engagement-chat/confirm) is kept intact
// and recoverable, gated behind this one flag so actions can be switched back
// on with an env change and no rebuild.
//
// Fails safe to OFF: enabled ONLY when ASSISTANT_ACTIONS_ENABLED is exactly the
// string "true" (mirrors SIGNWELL_TEST_MODE / QBO_ENVIRONMENT). Read from
// process.env directly rather than serverEnv() so it never depends on the full
// env schema being valid.
export function assistantActionsEnabled(): boolean {
  return process.env.ASSISTANT_ACTIONS_ENABLED === "true";
}
