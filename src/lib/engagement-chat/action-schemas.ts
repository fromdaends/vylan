// The engagement chat's action catalog: every action the model may PROPOSE,
// with strict validation of the model-supplied inputs. Pure module (no I/O)
// so the whole catalog is unit-testable.
//
// Two shapes per action:
//  - the model INPUT (what the propose_* tool accepts, validated here), and
//  - the stored PAYLOAD (input + human-facing snapshot fields the proposal
//    step enriches server-side: file names, item labels, current values).
// The confirm card renders from the stored payload, and the executor
// re-reads ONLY the stored payload — never anything model-supplied at
// confirm time.

import { z } from "zod";
import { DOC_TYPES } from "@/lib/doc-types";

export const ACTION_TYPES = [
  "approve_document",
  "reject_document",
  "send_reminder",
  "add_checklist_item",
  "edit_checklist_item",
  "remove_checklist_item",
  "change_due_date",
  "change_assignee",
] as const;

export type ChatActionType = (typeof ACTION_TYPES)[number];

const uuid = z.string().uuid();

// Matches the reject routes' existing 2..500 rule (min_2_chars / too_long).
const rejectionReason = z.string().trim().min(2).max(500);

const label = z.string().trim().min(1).max(200);

// The engagement builder's doc_type enum — validate against the canonical
// list so the model can't invent a type the DB enum would reject.
const docType = z
  .string()
  .refine((v) => (DOC_TYPES as readonly string[]).includes(v), {
    message: "unknown doc_type",
  });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), {
    message: "invalid date",
  });

export const ACTION_INPUT_SCHEMAS = {
  approve_document: z.object({ file_id: uuid }).strict(),
  reject_document: z
    .object({ file_id: uuid, reason: rejectionReason })
    .strict(),
  send_reminder: z.object({}).strict(),
  add_checklist_item: z
    .object({
      label,
      doc_type: docType.optional(),
      required: z.boolean().optional(),
    })
    .strict(),
  edit_checklist_item: z
    .object({
      item_id: uuid,
      new_label: label.optional(),
      required: z.boolean().optional(),
      doc_type: docType.optional(),
    })
    .strict()
    .refine(
      (v) =>
        v.new_label !== undefined ||
        v.required !== undefined ||
        v.doc_type !== undefined,
      { message: "no changes given" },
    ),
  remove_checklist_item: z.object({ item_id: uuid }).strict(),
  change_due_date: z
    .object({
      // null / omitted with clear=true removes the due date.
      due_date: isoDate.nullable(),
    })
    .strict(),
  change_assignee: z.object({ user_id: uuid }).strict(),
} satisfies Record<ChatActionType, z.ZodTypeAny>;

export type ActionInput<T extends ChatActionType> = z.infer<
  (typeof ACTION_INPUT_SCHEMAS)[T]
>;

// Validated model input for an action type, or a string error the tool
// result can carry back to the model (so it can correct itself).
export function parseActionInput(
  type: string,
  input: unknown,
):
  | { ok: true; type: ChatActionType; input: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!(ACTION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `Unknown action type: ${type}` };
  }
  const schema = ACTION_INPUT_SCHEMAS[type as ChatActionType];
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Invalid ${type} input: ${issue?.path.join(".") || "input"} ${
        issue?.message ?? "invalid"
      }`,
    };
  }
  return {
    ok: true,
    type: type as ChatActionType,
    input: parsed.data as Record<string, unknown>,
  };
}

// The stored payloads (input + snapshot). Kept as types (the proposal step
// constructs them in code, so zod on the way OUT would be redundant).
export type ActionPayloads = {
  approve_document: {
    file_id: string;
    file_name: string;
    item_label: string | null;
  };
  reject_document: {
    file_id: string;
    file_name: string;
    item_label: string | null;
    reason: string;
  };
  send_reminder: {
    client_name: string | null;
    client_email: string | null;
  };
  add_checklist_item: {
    label: string;
    doc_type: string;
    required: boolean;
  };
  edit_checklist_item: {
    item_id: string;
    item_label: string;
    changes: {
      new_label?: string;
      required?: boolean;
      doc_type?: string;
    };
  };
  remove_checklist_item: {
    item_id: string;
    item_label: string;
    files_count: number;
  };
  change_due_date: {
    from: string | null;
    to: string | null;
  };
  change_assignee: {
    user_id: string;
    member_name: string;
    from_name: string | null;
  };
};

export type AnyActionPayload = ActionPayloads[ChatActionType];

// Machine-readable failure codes surfaced on a card when execution fails.
export type ActionErrorCode =
  | "expired"
  | "already_resolved"
  | "state_changed"
  | "reminded_recently"
  | "execute_failed"
  | "not_found";
