import createMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

const intl = createMiddleware(routing);

// Chained middleware pattern: next-intl decides the final response
// (which may be a locale redirect or a "continue"), then Supabase
// writes its rotated auth cookies onto that same response. The previous
// implementation ran the two middlewares in parallel and merged cookies
// afterwards, which intermittently dropped cookie attributes (path /
// sameSite / expires) — making the browser treat the session as
// short-lived. Symptom: opening the app in a new tab forced a re-login.
export default async function proxy(request: NextRequest) {
  const response = intl(request);
  await updateSupabaseSession(request, response);
  return response;
}

export const config = {
  // Skip /r/* — the unauthenticated client portal manages its own locale.
  matcher: ["/", "/(fr|en)/:path*", "/((?!api|_next|_vercel|r/|.*\\..*).*)"],
};
