// Bookkeeping client-import staging (migration 0750).
//
// The OAuth callback stages the customer/contact list it read from the firm's
// own QuickBooks/Xero company; the import page reads it back for review. READS
// go through the authenticated client (RLS firm-scoped); WRITES (create +
// consume) are service-role. Sessions are one-shot and expire after an hour.

import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";

export type ImportCandidate = {
  display_name: string;
  email: string | null;
  phone: string | null;
};

export type ClientImportSession = {
  id: string;
  provider: "quickbooks" | "xero";
  sourceName: string | null;
  candidates: ImportCandidate[];
  createdAt: string;
  consumedAt: string | null;
};

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Missing-schema detection for THIS table (0750). The QuickBooks helper's regex
// matches quickbooks_* table names only, so it can't be reused here.
function isMissingSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /client_import_sessions/i.test(err.message ?? "") ||
    /could not find the table|relation .* does not exist|column .* does not exist/i.test(
      err.message ?? "",
    )
  );
}

// Keep only plausible candidates and cap the volume (the same 1000-row cap the
// CSV import enforces at commit — staging more is pointless).
export function sanitizeCandidates(raw: unknown): ImportCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportCandidate[] = [];
  for (const r of raw) {
    if (out.length >= 1000) break;
    const c = r as Record<string, unknown>;
    const name =
      typeof c.display_name === "string" ? c.display_name.trim() : "";
    if (!name || name.length > 160) continue;
    const email =
      typeof c.email === "string" && c.email.trim() ? c.email.trim() : null;
    const phone =
      typeof c.phone === "string" && c.phone.trim() ? c.phone.trim() : null;
    out.push({
      display_name: name,
      email: email && email.length <= 254 ? email : null,
      phone: phone && phone.length <= 40 ? phone : null,
    });
  }
  return out;
}

// Stage a fetched candidate list (service role — called by the OAuth callback,
// which has already authenticated the owner). Returns the session id, or null
// on failure (pre-0750 or a DB error) — the callback then redirects with an
// error flag instead of a session.
export async function createClientImportSession(input: {
  firmId: string;
  provider: "quickbooks" | "xero";
  sourceName: string | null;
  candidates: ImportCandidate[];
  createdBy: string | null;
}): Promise<string | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("client_import_sessions")
    .insert({
      firm_id: input.firmId,
      provider: input.provider,
      source_name: input.sourceName,
      candidates: input.candidates,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[client-import] create session failed:", error);
    }
    return null;
  }
  return (data?.id as string) ?? null;
}

// Read a session for review (authenticated — RLS proves it belongs to the
// caller's firm). Returns null when missing, consumed, expired, or pre-0750.
export async function getClientImportSession(
  id: string,
): Promise<ClientImportSession | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("client_import_sessions")
    .select("id, provider, source_name, candidates, created_at, consumed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[client-import] read session failed:", error);
    }
    return null;
  }
  if (!data) return null;
  if (data.consumed_at) return null;
  const createdAt = Date.parse(data.created_at as string);
  if (Number.isNaN(createdAt) || Date.now() - createdAt > SESSION_TTL_MS) {
    return null;
  }
  return {
    id: data.id as string,
    provider: data.provider === "xero" ? "xero" : "quickbooks",
    sourceName: (data.source_name as string | null) ?? null,
    candidates: sanitizeCandidates(data.candidates),
    createdAt: data.created_at as string,
    consumedAt: null,
  };
}

// Stamp a session consumed once its import commits (service role, best-effort —
// an unstamped session simply expires on its own).
export async function consumeClientImportSession(id: string): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("client_import_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id);
  if (error && !isMissingSchema(error)) {
    console.error("[client-import] consume session failed:", error);
  }
}
