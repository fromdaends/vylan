import createMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

const intl = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const supabaseResponse = await updateSupabaseSession(request);
  const intlResponse = intl(request);

  for (const cookie of supabaseResponse.cookies.getAll()) {
    intlResponse.cookies.set(cookie.name, cookie.value, cookie);
  }

  return intlResponse;
}

export const config = {
  matcher: ["/", "/(fr|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
