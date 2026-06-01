// Whether saving an edit to a client's email should pause for a deliberate
// confirmation. The email is the address that document-request links and
// reminders get delivered to, so a real change to it is confirmed before it
// saves. Creating a client (no prior address to protect) and no-op edits
// (same value, possibly with different surrounding whitespace) are not.
export function emailChangeNeedsConfirm(
  mode: "create" | "edit",
  savedEmail: string | null | undefined,
  nextEmail: string,
): boolean {
  if (mode !== "edit") return false;
  return nextEmail.trim() !== (savedEmail ?? "").trim();
}
