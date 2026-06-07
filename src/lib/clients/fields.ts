// Client profile field options — province, timezone, industry (migration 0220).
//
// Neutral module (no "use client") so the server (Zod validation) and the
// client form can both import it. Labels are bilingual and rendered inline by
// the form (locale === "fr" ? fr : en), which keeps a 32-row industry list out
// of messages/*.json.

export type FieldOption = { value: string; en: string; fr: string };

export function fieldLabel(
  options: FieldOption[],
  value: string | null | undefined,
  locale: "fr" | "en",
): string | null {
  if (!value) return null;
  const o = options.find((x) => x.value === value);
  if (!o) return value;
  return locale === "fr" ? o.fr : o.en;
}

// Canadian provinces + territories.
export const PROVINCES: FieldOption[] = [
  { value: "QC", en: "Quebec", fr: "Québec" },
  { value: "ON", en: "Ontario", fr: "Ontario" },
  { value: "BC", en: "British Columbia", fr: "Colombie-Britannique" },
  { value: "AB", en: "Alberta", fr: "Alberta" },
  { value: "MB", en: "Manitoba", fr: "Manitoba" },
  { value: "SK", en: "Saskatchewan", fr: "Saskatchewan" },
  { value: "NS", en: "Nova Scotia", fr: "Nouvelle-Écosse" },
  { value: "NB", en: "New Brunswick", fr: "Nouveau-Brunswick" },
  { value: "NL", en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador" },
  { value: "PE", en: "Prince Edward Island", fr: "Île-du-Prince-Édouard" },
  { value: "YT", en: "Yukon", fr: "Yukon" },
  { value: "NT", en: "Northwest Territories", fr: "Territoires du Nord-Ouest" },
  { value: "NU", en: "Nunavut", fr: "Nunavut" },
];

// Canadian timezones (matches the firm-level list used in Settings/onboarding).
export const TIMEZONES: FieldOption[] = [
  { value: "America/Toronto", en: "Eastern (Toronto)", fr: "Est (Toronto)" },
  { value: "America/Halifax", en: "Atlantic (Halifax)", fr: "Atlantique (Halifax)" },
  { value: "America/St_Johns", en: "Newfoundland (St. John's)", fr: "Terre-Neuve (St. John's)" },
  { value: "America/Winnipeg", en: "Central (Winnipeg)", fr: "Centre (Winnipeg)" },
  { value: "America/Edmonton", en: "Mountain (Edmonton)", fr: "Rocheuses (Edmonton)" },
  { value: "America/Vancouver", en: "Pacific (Vancouver)", fr: "Pacifique (Vancouver)" },
];

// Industry list (from the founder's category screenshots). Slugs are stable;
// labels are localized for display only.
export const INDUSTRIES: FieldOption[] = [
  { value: "agency_sales_house", en: "Agency or Sales House", fr: "Agence ou maison de vente" },
  { value: "agriculture", en: "Agriculture", fr: "Agriculture" },
  { value: "art_design", en: "Art and Design", fr: "Art et design" },
  { value: "automotive", en: "Automotive", fr: "Automobile" },
  { value: "construction", en: "Construction", fr: "Construction" },
  { value: "consulting", en: "Consulting", fr: "Conseil" },
  { value: "consumer_packaged_goods", en: "Consumer Packaged Goods", fr: "Biens de consommation" },
  { value: "education", en: "Education", fr: "Éducation" },
  { value: "engineering", en: "Engineering", fr: "Ingénierie" },
  { value: "entertainment", en: "Entertainment", fr: "Divertissement" },
  { value: "financial_services", en: "Financial Services", fr: "Services financiers" },
  { value: "food_services", en: "Food Services (Restaurants/Fast Food)", fr: "Restauration" },
  { value: "gaming", en: "Gaming", fr: "Jeux vidéo" },
  { value: "government", en: "Government", fr: "Gouvernement" },
  { value: "health_care", en: "Health Care", fr: "Santé" },
  { value: "interior_design", en: "Interior Design", fr: "Design d'intérieur" },
  { value: "internal", en: "Internal", fr: "Interne" },
  { value: "legal", en: "Legal", fr: "Juridique" },
  { value: "manufacturing", en: "Manufacturing", fr: "Fabrication" },
  { value: "marketing", en: "Marketing", fr: "Marketing" },
  { value: "mining_logistics", en: "Mining and Logistics", fr: "Mines et logistique" },
  { value: "non_profit", en: "Non-Profit", fr: "Organisme sans but lucratif" },
  { value: "publishing_web_media", en: "Publishing and Web Media", fr: "Édition et médias web" },
  { value: "real_estate", en: "Real Estate", fr: "Immobilier" },
  { value: "retail", en: "Retail (E-Commerce and Offline)", fr: "Commerce de détail (en ligne et physique)" },
  { value: "services", en: "Services", fr: "Services" },
  { value: "technology", en: "Technology", fr: "Technologie" },
  { value: "telecommunications", en: "Telecommunications", fr: "Télécommunications" },
  { value: "travel_hospitality", en: "Travel/Hospitality", fr: "Voyage / Hôtellerie" },
  { value: "web_design", en: "Web Designing", fr: "Conception web" },
  { value: "web_development", en: "Web Development", fr: "Développement web" },
  { value: "writers", en: "Writers", fr: "Rédaction" },
];

export const PROVINCE_VALUES = PROVINCES.map((p) => p.value);
export const TIMEZONE_VALUES = TIMEZONES.map((t) => t.value);
export const INDUSTRY_VALUES = INDUSTRIES.map((i) => i.value);
