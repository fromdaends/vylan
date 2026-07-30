// GET /r/[token]/to/[id] — the portal engagement switcher's hop.
//
// Verifies the target engagement is a SIBLING of the current token's client
// (resolveSiblingPortalToken enforces same client + firm + portal-accessible),
// then 302-redirects to that sibling's portal. The sibling's magic token is
// resolved SERVER-SIDE and only ever appears in the redirect Location — it is
// never embedded in the switcher's HTML, so a leaked portal link doesn't carry
// the client's other links in its page source. An invalid or foreign target
// falls back to the current portal rather than erroring.

import { NextResponse, type NextRequest } from "next/server";
import { resolveSiblingPortalToken } from "@/lib/db/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const targetToken = await resolveSiblingPortalToken(token, id);
  // Preserve the portal language choice across the hop (English is the default,
  // so only ?lang=fr needs carrying).
  const suffix =
    request.nextUrl.searchParams.get("lang") === "fr" ? "?lang=fr" : "";
  const dest = targetToken
    ? `/r/${targetToken}${suffix}`
    : `/r/${token}${suffix}`;
  return NextResponse.redirect(new URL(dest, request.url));
}
