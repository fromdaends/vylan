// Cache-busting that matches how the routes are ACTUALLY served.
//
// The app runs next-intl with `localePrefix: "as-needed"` and `defaultLocale:
// "en"`, so an English page lives at /quickbooks/drafts — with NO /en prefix.
// French keeps its /fr.
//
// Every call site so far did:
//
//   for (const loc of ["en", "fr"]) revalidatePath(`/${loc}/engagements/${id}`)
//
// which revalidates /en/engagements/… — a path that is never rendered. So for
// every English user the invalidation silently missed and the page kept
// serving its cached copy. Found by posting a draft to Xero and watching the
// row keep saying "Approved", with a live Post button, until a manual reload —
// the post had in fact succeeded. The same silent miss applied to 34 call sites
// across 18 files, i.e. most "why didn't the page update?" behaviour in the app.
//
// Nothing errors when a path does not match, which is why it went unnoticed.

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";

// The real URL of a path for one locale, honouring the prefix strategy.
export function localizedPath(path: string, locale: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  // The routing config is typed to this app's actual strategy ("as-needed"),
  // where only the DEFAULT locale drops its prefix. Written against
  // routing.defaultLocale rather than a hard-coded "en" so changing the default
  // moves the unprefixed route with it.
  return locale === routing.defaultLocale ? clean : `/${locale}${clean}`;
}

// Revalidate one app path across every locale, at the URL each is served from.
// Pass the path WITHOUT a locale: revalidateAllLocales("/quickbooks/drafts").
export function revalidateAllLocales(path: string): void {
  for (const locale of routing.locales) {
    revalidatePath(localizedPath(path, locale));
  }
}
