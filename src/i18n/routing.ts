import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en"] as const,
  // English is the default landing experience (Vylan serves all of Canada, not
  // just Quebec). French is fully supported — it's a deliberate toggle (the
  // /fr prefix) rather than the unprefixed default.
  defaultLocale: "en",
  localePrefix: "as-needed",
  // Honour the saved-language cookie (NEXT_LOCALE, written by the Settings
  // language switch) so a user's choice STICKS across logout/login and
  // unprefixed entry points — but NOT the browser's Accept-Language header, so a
  // first-time visitor (no cookie) still always lands in English unless they
  // choose French. The client portal is excluded from this middleware (it sets
  // its own locale and always defaults to English) — see proxy.ts matcher.
  localeDetection: { cookie: true, header: false },
});

export type AppLocale = (typeof routing.locales)[number];
