// Collapse the single/legacy label + description fields a client may post into
// one of each. Version-proof: a client bundle cached from any recent deploy
// sends SOME of these names (current `label`/`description`, or legacy
// `label_fr`/`label_en`/`description_fr`) — taking whichever is present means
// the add never fails just because the browser and server are a version apart.
//
// Pure + framework-free so it's unit-tested directly. It lives here (not in the
// "use server" actions file, which may only export async server actions).
export function pickAddItemFields(d: {
  label?: string | null;
  label_fr?: string | null;
  label_en?: string | null;
  description?: string | null;
  description_fr?: string | null;
}): { label: string; description: string | null } {
  const label = (d.label || d.label_fr || d.label_en || "").trim();
  const description = (d.description || d.description_fr || "").trim() || null;
  return { label, description };
}
