"use server";

import { revalidatePath } from "next/cache";
import { enqueueJob } from "@/lib/db/jobs";
import { getServerSupabase } from "@/lib/supabase/server";

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

  await enqueueJob({
    kind: "classify_document",
    payload: { uploaded_file_id: id },
    runAfter: new Date(),
  });
  revalidatePath("/", "layout");
}
