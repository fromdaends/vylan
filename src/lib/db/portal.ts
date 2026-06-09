// Portal queries — used by the unauthenticated /r/[token] route and its
// API actions. Always goes through the service-role client; never through
// the user's session client.
//
// SECURITY: The only valid entry point is `loadPortalContext(token)`, which
// verifies the token format AND that an engagement matches AND that the
// expiry hasn't passed. Every other helper assumes the token has already
// been validated.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { Engagement } from "./engagements";
import type { Client } from "./clients";
import type { Firm } from "./firms";
import type { RequestItem, RequestItemStatus } from "./request-items";
import type { UsabilityVerdict } from "@/lib/ai/usability";
import { resolveFileReason } from "@/lib/review/file-reason";
import { BUCKET } from "@/lib/storage";

const TOKEN_REGEX = /^[0-9A-Za-z]{43}$/;

export function isValidTokenShape(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export type PortalFile = {
  id: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  // For a rejected file ONLY: the plain-language, client-facing reason it needs
  // fixing, in both languages so it follows the portal's language toggle. The AI
  // writes issue_summary_fr/en FOR the client; we fall back to the accountant's
  // typed rejection_reason (single language, mirrored into both). null on any
  // approved / in-review file, and on a rejected file with no reason recorded.
  // Client-safe: never an AI code, score, or the word "flagged".
  reason: { fr: string; en: string } | null;
  // The stored MIME type, so the portal can show a real picture for image files
  // (and a labelled tile for PDFs / other types). Null only for legacy rows.
  mime: string | null;
  // For an IMAGE file: a signed URL straight to the stored file in Supabase
  // storage, so the portal serves it directly (which stays reliable when a line
  // has many files firing requests at once) instead of rendering each thumbnail
  // on the fly. Null for non-images and on any signing failure (the tile then
  // falls back to the render route, then to an icon).
  url: string | null;
};

export type PortalContext = {
  engagement: Engagement;
  client: Client;
  firm: Firm;
  items: RequestItem[];
  uploaded_count_by_item: Record<string, number>;
  // The files the client has actually sent for each item (oldest first), each
  // with the accountant's per-file decision. Powers the portal's per-document
  // list + re-upload. Client-safe: only the client's own filename + a simple
  // status (never AI codes, scores, or the word "flagged").
  files_by_item: Record<string, PortalFile[]>;
  // Bilingual AI rejection summary per item, taken from the latest upload's
  // usability verdict (the model writes it in both languages). Lets the
  // portal's re-upload banner follow the language toggle instead of being stuck
  // in the single language `request_items.rejection_reason` was written in.
  // Only present for items whose latest upload was flagged.
  rejection_summary_by_item: Record<string, { fr: string; en: string }>;
  // The "your accountant" contact surfaced in the portal footer. Resolves to
  // the user assigned to the engagement, falling back to the firm owner. Null
  // only if neither has an email on file (shouldn't happen — users.email is
  // NOT NULL — but the footer degrades gracefully if it ever is).
  accountant_email: string | null;
};

export async function loadPortalContext(
  token: string,
): Promise<PortalContext | null> {
  if (!isValidTokenShape(token)) return null;
  const sb = getServiceRoleSupabase();

  const { data: engagement, error: e1 } = await sb
    .from("engagements")
    .select("*")
    .eq("magic_token", token)
    .maybeSingle();
  if (e1 || !engagement) return null;
  if (engagement.status === "cancelled") return null;
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return null;
  }

  const { data: client } = await sb
    .from("clients")
    .select("*")
    .eq("id", engagement.client_id)
    .single();
  const { data: firm } = await sb
    .from("firms")
    .select("*")
    .eq("id", engagement.firm_id)
    .single();
  const { data: items } = await sb
    .from("request_items")
    .select("*")
    .eq("engagement_id", engagement.id)
    .order("order_index", { ascending: true });

  if (!client || !firm || !items) return null;

  const { data: uploaded } = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, original_filename, review_status, rejection_reason, mime_type, storage_path, uploaded_at, ai_usability, is_duplicate",
    )
    .eq("engagement_id", engagement.id)
    .order("uploaded_at", { ascending: true });

  // Sign direct storage URLs for image files so the portal loads them straight
  // from Supabase storage (which serves many concurrent requests reliably)
  // rather than rendering every thumbnail on the fly — a line with 20+ files
  // fired that many render requests at once and overran the image route. PDFs
  // are served via the bytes endpoint, not here. Generous TTL so the URLs
  // outlive a long portal session.
  const imagePaths = Array.from(
    new Set(
      (uploaded ?? [])
        .filter(
          (u) =>
            typeof u.mime_type === "string" &&
            (u.mime_type as string).startsWith("image/"),
        )
        .map((u) => u.storage_path as string),
    ),
  );
  const urlByPath = new Map<string, string>();
  if (imagePaths.length > 0) {
    const { data: signed } = await sb.storage
      .from(BUCKET)
      .createSignedUrls(imagePaths, 60 * 60 * 4);
    for (const s of signed ?? []) {
      if (s.signedUrl && !s.error && s.path) urlByPath.set(s.path, s.signedUrl);
    }
  }

  const counts: Record<string, number> = {};
  // Ascending order → the last write per item wins, so this reflects the
  // LATEST upload's verdict. A later clean upload supersedes an earlier flag.
  const rejectionSummaryByItem: Record<string, { fr: string; en: string }> = {};
  // The per-item file list (oldest first, matching the query order).
  const filesByItem: Record<string, PortalFile[]> = {};
  for (const u of uploaded ?? []) {
    // A detected duplicate is hidden from the client: their original copy still
    // shows, so they never see the same file listed twice (or a confusing
    // "rejected" on an accidental re-upload). The accountant still sees it.
    if (u.is_duplicate) continue;
    counts[u.request_item_id] = (counts[u.request_item_id] ?? 0) + 1;
    const v = u.ai_usability as UsabilityVerdict | null;
    const fr = v?.issue_summary_fr?.trim();
    const en = v?.issue_summary_en?.trim();
    const status = (u.review_status as PortalFile["status"]) ?? "pending";
    (filesByItem[u.request_item_id] ??= []).push({
      id: u.id as string,
      name: (u.original_filename as string) ?? "",
      status,
      // Per-file client-facing reason, only for a rejected file. See
      // resolveFileReason for the priority (AI summary > accountant's typed
      // reason) and the no-jargon guarantee.
      reason: resolveFileReason(status, v, u.rejection_reason as string | null),
      mime: (u.mime_type as string | null) ?? null,
      url:
        typeof u.mime_type === "string" && u.mime_type.startsWith("image/")
          ? (urlByPath.get(u.storage_path as string) ?? null)
          : null,
    });
    if (fr || en) {
      rejectionSummaryByItem[u.request_item_id] = {
        fr: fr || en || "",
        en: en || fr || "",
      };
    } else {
      delete rejectionSummaryByItem[u.request_item_id];
    }
  }

  // Resolve the accountant contact for the footer. Shared with the signed-copy
  // notification (the upload route) so the footer contact and that email reach
  // the SAME person: the user assigned to this engagement, falling back to the
  // firm owner.
  const accountantContact = await resolveAccountantContact(sb, {
    assignedUserId: (engagement.assigned_user_id as string | null) ?? null,
    firmId: engagement.firm_id as string,
  });
  const accountantEmail = accountantContact?.email ?? null;

  return {
    engagement: engagement as Engagement,
    client: client as Client,
    firm: firm as Firm,
    items: items as RequestItem[],
    uploaded_count_by_item: counts,
    files_by_item: filesByItem,
    rejection_summary_by_item: rejectionSummaryByItem,
    accountant_email: accountantEmail,
  };
}

export type AccountantContact = {
  email: string;
  // The accountant's preferred language — drives the language of notifications
  // sent to them (e.g. the "signed copy returned" email).
  locale: "fr" | "en";
  // Best display name (display_name > name), or null if neither is set.
  name: string | null;
};

// Resolve the "your accountant" contact for an engagement: the user assigned to
// it if one is set, otherwise the firm owner (earliest-created, in case of
// multiple owners). Service-role read — used by the UNAUTHENTICATED portal AND
// its API routes, so it lives here as the single source of truth: the portal
// footer contact and the "signed copy returned" notification must resolve the
// same person. Returns null only if neither has an email on file (shouldn't
// happen — users.email is NOT NULL — but callers degrade gracefully).
export async function resolveAccountantContact(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  opts: { assignedUserId: string | null; firmId: string },
): Promise<AccountantContact | null> {
  type Row = {
    email: string | null;
    locale: string | null;
    name: string | null;
    display_name: string | null;
  };
  const pick = (row: Row | null): AccountantContact | null => {
    if (!row?.email) return null;
    const name = row.display_name?.trim() || row.name?.trim() || null;
    return { email: row.email, locale: row.locale === "en" ? "en" : "fr", name };
  };

  if (opts.assignedUserId) {
    const { data } = await sb
      .from("users")
      .select("email, locale, name, display_name")
      .eq("id", opts.assignedUserId)
      .maybeSingle();
    const contact = pick(data as Row | null);
    if (contact) return contact;
  }
  const { data: owner } = await sb
    .from("users")
    .select("email, locale, name, display_name")
    .eq("firm_id", opts.firmId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return pick(owner as Row | null);
}

// Used exclusively by write endpoints (upload, mark-na, undo-na). Blocks
// any engagement state where further mutation shouldn't be allowed:
// cancelled (rejected outright) or complete (work already finished).
export async function findItemForToken(
  token: string,
  itemId: string,
): Promise<RequestItem | null> {
  if (!isValidTokenShape(token)) return null;
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, magic_expires_at, status")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement) return null;
  if (engagement.status === "cancelled" || engagement.status === "complete") {
    return null;
  }
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return null;
  }
  const { data: item } = await sb
    .from("request_items")
    .select("*")
    .eq("id", itemId)
    .eq("engagement_id", engagement.id)
    .maybeSingle();
  return (item as RequestItem) ?? null;
}

// Defense in depth: scope updates to (id, engagement_id) so a stale or wrong
// itemId can't accidentally mutate items in another engagement, even if a
// future refactor of findItemForToken stops scoping correctly.
export async function setItemStatus(
  itemId: string,
  status: RequestItemStatus,
  engagementId?: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  let q = sb.from("request_items").update({ status }).eq("id", itemId);
  if (engagementId) q = q.eq("engagement_id", engagementId);
  const { error } = await q;
  if (error) throw error;
}

export async function markEngagementInProgress(
  engagementId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  await sb
    .from("engagements")
    .update({ status: "in_progress" })
    .eq("id", engagementId)
    .eq("status", "sent");
}

export async function logActivity(
  firmId: string,
  engagementId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const sb = getServiceRoleSupabase();
  await sb.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "client",
    action,
    metadata,
  });
}
