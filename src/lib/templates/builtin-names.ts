// English display names for the built-in engagement templates.
//
// The built-ins are seeded (migrations 0005 + 0170) with FRENCH names only.
// Their document items are bilingual (label_fr / label_en), but the template
// `name` is a single column — so on the English setting the built-in TITLES
// would otherwise render in French. This overlay supplies an English name per
// built-in, applied wherever a built-in template name is displayed.
//
// Keyed by the stable seed UUID (not the French string) so it survives any
// later rename. Migration-free on purpose: built-in names are effectively seed
// content, this avoids a schema change, and it sidesteps the migration gate.
//
// Firm-created templates (firm_id set) are named by the firm in their own
// language, so they always keep their stored name — no overlay.
const BUILTIN_TEMPLATE_NAME_EN: Record<string, string> = {
  "00000000-0000-0000-0000-000000000001": "T1 — Personal",
  "00000000-0000-0000-0000-000000000002": "T2 — Corporation",
  "00000000-0000-0000-0000-000000000003": "Monthly bookkeeping",
  "00000000-0000-0000-0000-000000000005": "Self-employed (T2125)",
  "00000000-0000-0000-0000-000000000006": "Rental income (T776)",
  "00000000-0000-0000-0000-000000000007": "Final return (estate)",
  "00000000-0000-0000-0000-000000000008": "GST/QST return",
  "00000000-0000-0000-0000-000000000009": "Trust return (T3)",
  "00000000-0000-0000-0000-00000000000a": "New client onboarding",
};

// The minimal template shape this needs — avoids importing the full Template
// type (and its server-only db module) into client components.
type NamedTemplate = { id: string; firm_id: string | null; name: string };

// The template's name in the active locale. A built-in gets its English overlay
// when locale === "en"; French, or any firm-created template, falls back to the
// stored name. Unknown built-in ids fall back too, so a future built-in without
// an entry here degrades to its French name rather than breaking.
export function localizedTemplateName(
  template: NamedTemplate,
  locale: string,
): string {
  if (locale === "en" && template.firm_id == null) {
    return BUILTIN_TEMPLATE_NAME_EN[template.id] ?? template.name;
  }
  return template.name;
}
