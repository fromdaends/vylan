"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { enqueueJob } from "@/lib/db/jobs";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { processClassifyJob } from "@/lib/ai/process";

export async function reclassifyFileAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;

  // Sanity check: the file must belong to the user's firm. RLS enforces it,
  // but we explicitly check rather than blindly trust the form data.
  const sb = await getServerSupabase();
  const { data: file } = await sb
    .from("uploaded_files")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!file) return;

  // Queue for durability; also run inline so the badge updates immediately.
  await enqueueJob({
    kind: "classify_document",
    payload: { uploaded_file_id: id },
    runAfter: new Date(),
  });

  after(async () => {
    try {
      const result = await processClassifyJob({ uploaded_file_id: id });
      if (result.classified) {
        const root = getServiceRoleSupabase();
        await root
          .from("jobs")
          .update({ status: "done", last_error: "processed_inline" })
          .eq("kind", "classify_document")
          .eq("status", "pending")
          .eq("payload->>uploaded_file_id", id);
      }
    } catch (e) {
      console.error("[reclassify] inline run failed:", e);
    }
  });

  revalidatePath("/", "layout");
}
