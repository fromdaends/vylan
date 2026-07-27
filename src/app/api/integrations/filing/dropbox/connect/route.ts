import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getFirmStorageConnection } from "@/lib/db/filing";
import {
  buildDropboxAuthorizeUrl,
  isDropboxFilingConfigured,
} from "@/lib/filing/dropbox/oauth";
import { isStorageTokenEncryptionConfigured } from "@/lib/filing/token-cipher";

export const runtime = "nodejs";

export const DROPBOX_FILING_STATE_COOKIE = "dbxfiling_oauth_state";

// POST /api/integrations/filing/dropbox/connect — owner-only; refuses while
// another provider is connected (one destination per firm); production
// refuses without the token-encryption key. Same shape as google/microsoft.
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }
  if (!isDropboxFilingConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (
    process.env.NODE_ENV === "production" &&
    !isStorageTokenEncryptionConfigured()
  ) {
    console.error(
      "[filing/dropbox/connect] refused: STORAGE_TOKEN_ENC_KEY is not set.",
    );
    return NextResponse.json({ error: "encryption_required" }, { status: 503 });
  }
  const existing = await getFirmStorageConnection();
  if (existing && existing.provider !== "dropbox") {
    return NextResponse.json({ error: "other_provider" }, { status: 409 });
  }

  const state = randomUUID();
  const res = NextResponse.json({ url: buildDropboxAuthorizeUrl(state) });
  res.cookies.set(DROPBOX_FILING_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
