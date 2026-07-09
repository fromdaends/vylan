// The marker the code-readable fast path writes into
// uploaded_files.ai_extracted_fields.source, so every reader — the portal poll,
// the accountant checklist + preview, the set-assessment worker — can tell a
// code-read file (text-layer PDF / Excel / CSV, read WITHOUT the vision model)
// apart from an AI-classified one. Kept in its own tiny module with NO heavy
// imports so it is safe to pull into client components.

export const CODE_READ_SOURCE = "code";

export function isCodeReadFields(
  fields: Record<string, unknown> | null | undefined,
): boolean {
  return (
    !!fields && (fields as { source?: unknown }).source === CODE_READ_SOURCE
  );
}
