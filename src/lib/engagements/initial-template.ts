import type { Template } from "@/lib/db/templates";

// Resolve which template the New-engagement form opens on. When the user clicks
// "Use" on a template card, its id is carried to /engagements/new via the
// ?template= query param; the form should open on THAT template. The first
// template is only a fallback for a direct open (no ?template=) or a
// stale/unknown id.
//
// Pure + exported so the "fall back to first only when nothing valid was
// chosen" contract is unit-tested (the bug was: the chosen id was ignored and
// the form always opened on templates[0]).
export function resolveInitialTemplate(
  templates: Template[],
  initialTemplateId: string | undefined | null,
): Template | undefined {
  if (initialTemplateId) {
    const picked = templates.find((t) => t.id === initialTemplateId);
    if (picked) return picked;
  }
  return templates[0];
}
