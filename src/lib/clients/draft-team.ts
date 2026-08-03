// The create dialog's draft team, narrowed.
//
// Lives here rather than in app/actions/clients.ts because that file is
// "use server", and such a module may export ASYNC functions only — a sync
// export compiles cleanly and then fails the production build naming something
// else entirely. Being a plain module also makes it directly testable, which a
// server-action file is not.
//
// This value arrives as a hidden form field, so it is browser-supplied and gets
// narrowed like any other untrusted input. Every rejection path ends with the
// client still being created: losing a team is recoverable in one panel, losing
// the client is not.
export function parseDraftTeam(
  raw: FormDataEntryValue | null,
): { userId: string; position: string | null }[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { userId: string; position: string | null }[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const userId = typeof o.userId === "string" ? o.userId.trim() : "";
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const position =
      typeof o.position === "string" && o.position.trim()
        ? o.position.trim().slice(0, 60)
        : null;
    out.push({ userId, position });
  }
  return out;
}
