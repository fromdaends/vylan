"use server";

// Push a checklist item's document-check SET summary into the engagement chat
// as an assistant message, so the accountant can read the full summary in the
// chat and ask follow-ups about it. Server-derived (re-reads the item's
// assessment RLS-scoped) — the client only sends ids, never the text.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getEngagement } from "@/lib/db/engagements";
import {
  getConversationId,
  insertChatMessage,
  CHAT_SCHEMA_MISSING,
} from "@/lib/engagement-chat/db";
import type { SetAssessment } from "@/lib/ai/set-assessment";

export async function pushSetSummaryToChatAction(
  engagementId: string,
  itemId: string,
): Promise<{ ok: boolean }> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false };

  // Defence-in-depth firm scoping (getEngagement is RLS-scoped too).
  const engagement = await getEngagement(engagementId);
  if (!engagement || engagement.firm_id !== firm.id) return { ok: false };

  const sb = await getServerSupabase();
  const { data: item } = await sb
    .from("request_items")
    .select("label, ai_set_assessment")
    .eq("id", itemId)
    .eq("engagement_id", engagementId)
    .maybeSingle();
  const assessment = (item?.ai_set_assessment ?? null) as SetAssessment | null;
  if (!assessment) return { ok: false };

  const locale = user.locale === "fr" ? "fr" : "en";
  const conclusion =
    locale === "fr"
      ? assessment.conclusion_fr || assessment.conclusion_en
      : assessment.conclusion_en || assessment.conclusion_fr;
  if (!conclusion) return { ok: false };

  const pct = Math.round(
    Math.max(0, Math.min(1, assessment.confidence)) * 100,
  );
  const label = (item?.label as string | null) ?? "";
  const header =
    locale === "fr" ? "Vérification des documents" : "Document check";
  const content = `**${header}${label ? ` — ${label}` : ""}**\n\n${conclusion}\n\n_${pct}%_`;

  const conversationId = await getConversationId(sb, firm.id, engagementId, {
    create: true,
  });
  if (!conversationId || conversationId === CHAT_SCHEMA_MISSING) {
    return { ok: false };
  }

  const res = await insertChatMessage(sb, {
    conversationId,
    firmId: firm.id,
    userId: null,
    role: "assistant",
    content,
  });
  if (res === CHAT_SCHEMA_MISSING) return { ok: false };

  return { ok: true };
}
