import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en"] as const,
  // English is the default landing experience (Vylan serves all of Canada, not
  // just Quebec). French is fully supported — it's a deliberate toggle (the
  // /fr prefix) rather than the unprefixed default.
  defaultLocale: "en",
  localePrefix: "as-needed",
  // Don't auto-switch to French from the browser's Accept-Language header — a
  // first-time visitor always lands in English unless they choose French.
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];
