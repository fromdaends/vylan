import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { getFirmStorageConnection } from "@/lib/db/filing";
import {
  buildMicrosoftAuthorizeUrl,
  isMicrosoftFilingConfigured,
} from "@/lib/filing/microsoft/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";

export const runtime = "nodejs";

// Anti-forgery state cookie, verified by the callback.
export const MS_FILING_STATE_COOKIE = "msfiling_oauth_state";

// POST /api/integrations/filing/microsoft/connect
//
// Starts Microsoft OAuth for the SharePoint/OneDrive filing connector.
// Owner-only; refuses while ANOTHER provider is connected (one destination
// per firm); production refuses without the token-encryption key.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (!can(me, "integrations.manage")) {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  if (!isMicrosoftFilingConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (
    process.env.NODE_ENV === "production" &&
    !isStorageTokenEncryptionConfigured()
  ) {
    console.error(
      "[filing/microsoft/connect] refused: STORAGE_TOKEN_ENC_KEY is not set. Set the key before connecting storage in production.",
    );
    return NextResponse.json({ error: "encryption_required" }, { status: 503 });
  }

  const existing = await getFirmStorageConnection();
  if (existing && existing.provider !== "microsoft") {
    return NextResponse.json({ error: "other_provider" }, { status: 409 });
  }

  const state = randomUUID();
  const res = NextResponse.json({ url: buildMicrosoftAuthorizeUrl(state) });
  res.cookies.set(MS_FILING_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
