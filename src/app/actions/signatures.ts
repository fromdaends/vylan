"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { addSignatureItemToEngagement } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import { getClient } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  MAX_BYTES,
  isAllowedMime,
  signingDocPath,
  uploadObject,
  truncateFilename,
  getBrandingImageUrlForEmail,
} from "@/lib/storage";
import { sendEmail, buildSignatureRequestEmail } from "@/lib/email";
import type { ItemActionState } from "@/app/actions/items";

// Accountant creates a SIGNATURE item: they name it (FR + EN) and upload the
// document the client needs to sign. We store that blank document, create the
// item (kind='signature'), and email the client that a signature is waiting.
// The client returns the signed copy through the normal upload flow (Phase 3).
export async function addSignatureItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const engagementId = formData.get("engagement_id");
  const labelFr = formData.get("label_fr");
  const labelEn = formData.get("label_en");
  const file = formData.get("file");

  if (
    typeof engagementId !== "string" ||
    !engagementId ||
    typeof labelFr !== "string" ||
    !labelFr.trim() ||
    typeof labelEn !== "string" ||
    !labelEn.trim()
  ) {
    return { error: "generic" };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "file" };
  if (file.size > MAX_BYTES) return { error: "file" };
  if (!isAllowedMime(file.type)) return { error: "file" };

  // The session client is RLS-scoped, so the accountant can only resolve their
  // own firm's engagement — creating a signature item here is firm-isolated.
  const sb = await getServerSupabase();
  const { data: eng } = await sb
    .from("engagements")
    .select("id, firm_id, client_id, magic_token")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) return { error: "generic" };

  // Store the blank document to be signed.
  const safeName = truncateFilename(file.name);
  const uuid = nanoid(12);
  const path = signingDocPath({
    firmId: eng.firm_id as string,
    engagementId,
    uuid,
    filename: safeName,
  });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadObject({
      path,
      body: bytes,
      contentType: file.type || "application/octet-stream",
    });
  } catch {
    return { error: "generic" };
  }

  // Create the signature item pointing at that document.
  let itemId: string;
  try {
    const item = await addSignatureItemToEngagement({
      engagement_id: engagementId,
      label: labelEn.trim(),
      label_fr: labelFr.trim(),
      signing_doc_path: path,
      signing_doc_name: safeName,
      signing_doc_mime: file.type || "application/octet-stream",
    });
    itemId = item.id;
  } catch {
    return { error: "generic" };
  }

  await logUserActivity(eng.firm_id as string, engagementId, "add_item", {
    item_id: itemId,
    label: labelFr.trim(),
  });

  // Tell the client a signature is waiting. Best-effort — never fail the action
  // on an email hiccup (the item already exists and shows in the portal).
  try {
    const [client, firm] = await Promise.all([
      getClient(eng.client_id as string),
      getCurrentFirm(),
    ]);
    if (client?.email && firm && eng.magic_token) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const url = `${appUrl}/r/${eng.magic_token}`;
      const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
      const { subject, html, text } = buildSignatureRequestEmail({
        clientName: client.display_name,
        firmName: firm.name,
        firmLogoUrl,
        documentName: (client.locale === "en" ? labelEn : labelFr).trim(),
        url,
        locale: client.locale,
      });
      await sendEmail({ to: client.email, subject, html, text });
    }
  } catch (e) {
    console.error("[addSignatureItemAction] email failed:", e);
  }

  revalidatePath(`/engagements/${engagementId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
