// The engagement chat's tools: phase-2 READ tools (no side effects) plus the
// phase-3 PROPOSE tools. A propose tool NEVER executes anything — it
// validates, writes a pending-action row, and hands the panel a confirm
// card; the model only ever learns "proposed, awaiting confirmation".
// Execution lives exclusively behind POST /api/engagement-chat/confirm.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compactFileDetails,
  isFlagged,
  searchFiles,
  type ChatFileRow,
  type SearchCriteria,
} from "./search";
import {
  fetchChatActivity,
  fetchChatEngagement,
  fetchChatFiles,
  fetchChatItems,
  fetchClientName,
  fetchLatestPayment,
  fetchUserLabel,
} from "./data";
import { listActiveFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { parseActionInput } from "./action-schemas";
import { buildActionProposal } from "./actions";
import {
  createPendingAction,
  toCard,
  type ActionCardData,
} from "./pending-actions";
import { CHAT_SCHEMA_MISSING } from "./db";
import { DOC_TYPES } from "@/lib/doc-types";

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_engagement_overview",
    description:
      "Status snapshot of the selected engagement: title, client, status, due date, assignee, checklist counts by status, signature items, latest payment request, and when the client last uploaded. Call this first for broad questions like \"where does this stand?\" or \"what's still missing?\".",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_checklist_items",
    description:
      "Every checklist item of the engagement with its status (pending / submitted / approved / rejected / na), whether it's required, its rejection reason, and the AI page-completeness verdict when one exists. Use for \"what's missing\", \"what got rejected\", or anything item-level.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_documents",
    description:
      "Search the engagement's uploaded documents by any combination of filters over the structured data the AI extracted at upload (never the raw files). Returns compact matches plus the total count. Omit every filter to list all documents.",
    input_schema: {
      type: "object",
      properties: {
        vendor: {
          type: "string",
          description:
            "Vendor / issuer / person name, e.g. \"Staples\" or \"Hydro-Québec\". Accent- and case-insensitive.",
        },
        amount: {
          type: "number",
          description:
            "A dollar amount that appears on the document (total, a labelled box, or a line item). Matched to the cent unless amount_tolerance is given.",
        },
        amount_tolerance: {
          type: "number",
          description: "Widen the amount match by ± this many dollars.",
        },
        doc_type: {
          type: "string",
          description:
            "Document type code, e.g. t4, rl1, receipt, invoice, bank_statement, other.",
        },
        status: {
          type: "string",
          enum: ["pending", "approved", "rejected"],
          description: "Review status filter.",
        },
        flagged_only: {
          type: "boolean",
          description:
            "Only documents needing attention: unusable, rejected, duplicate, or with a noted concern.",
        },
        year: {
          type: "number",
          description: "Tax/document year, e.g. 2025.",
        },
        text: {
          type: "string",
          description: "Free text across names, identifiers, and labels.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_document_details",
    description:
      "Everything extracted from ONE document: identifiers, labelled amounts, usability verdict (with the client-facing summary), rejection info, and the receipt/invoice transaction breakdown (vendor, taxes, line items) when present. Use after search_documents when a question needs the fine detail.",
    input_schema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The file_id from a search_documents result.",
        },
      },
      required: ["file_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_activity",
    description:
      "The engagement's recent activity log entries (uploads, approvals, rejections, reminders, payments, signatures, AI verdicts), newest first. Use for \"when did the client last do X\" or \"what happened recently\".",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many entries (default 20, max 50).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_team_members",
    description:
      "The firm's active members (user_id + name + role) — the valid targets for propose_change_assignee.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// The PROPOSE tools. Each creates a confirm card for the accountant;
// NOTHING executes until they press Confirm. Descriptions repeat that so the
// model never claims an action happened.
const PROPOSAL_NOTE =
  "This only PROPOSES the action: the accountant sees a card with Confirm and Cancel, and nothing happens until they confirm. Never say the action was done — say it is waiting for their confirmation.";

export const CHAT_ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_approve_document",
    description: `Propose approving one uploaded document. Find its file_id with search_documents first. ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "From a search_documents result." },
      },
      required: ["file_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_reject_document",
    description: `Propose rejecting one uploaded document with a reason the CLIENT will see in their portal (2-500 characters, in the client's language when known). ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "From a search_documents result." },
        reason: {
          type: "string",
          description: "Client-facing reason, e.g. \"Pages 2 à 6 manquantes\".",
        },
      },
      required: ["file_id", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_send_reminder",
    description: `Propose emailing the client their portal-link reminder right now. Refused if a manual reminder was already sent recently. ${PROPOSAL_NOTE}`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_add_checklist_item",
    description: `Propose adding a document-collection item to the checklist. ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "The item name the client sees." },
        doc_type: {
          type: "string",
          description: `Document type code (default "other"). One of: ${DOC_TYPES.join(", ")}.`,
        },
        required: {
          type: "boolean",
          description: "Whether the client must provide it (default true).",
        },
      },
      required: ["label"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_edit_checklist_item",
    description: `Propose editing an existing checklist item's name, required flag, or document type. Get item_id from list_checklist_items. Signature items can't be edited. ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "From list_checklist_items." },
        new_label: { type: "string" },
        required: { type: "boolean" },
        doc_type: { type: "string", description: `One of: ${DOC_TYPES.join(", ")}.` },
      },
      required: ["item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_remove_checklist_item",
    description: `Propose removing a checklist item. Its uploaded documents are removed with it, so the card warns about that. Get item_id from list_checklist_items. ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "From list_checklist_items." },
      },
      required: ["item_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_change_due_date",
    description: `Propose changing the engagement's due date (YYYY-MM-DD), or clearing it with null. Reminders are rescheduled accordingly. ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        due_date: {
          type: ["string", "null"],
          description: "New date as YYYY-MM-DD, or null to remove the due date.",
        },
      },
      required: ["due_date"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_change_assignee",
    description: `Propose reassigning the engagement to another active firm member. Get their user_id from list_team_members. ${PROPOSAL_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "From list_team_members." },
      },
      required: ["user_id"],
      additionalProperties: false,
    },
  },
];

export type ChatToolContext = {
  sb: SupabaseClient;
  engagementId: string;
  // Memoized files fetch — several tools read the same rows per turn.
  getFiles: () => Promise<ChatFileRow[]>;
  // Phase 3 proposal wiring (from the message route): who is asking, which
  // conversation the card belongs to, and how to push the card to the panel.
  firmId: string;
  userId: string;
  conversationId: string;
  onProposal: (card: ActionCardData) => void;
};

export function createChatToolContext(opts: {
  sb: SupabaseClient;
  engagementId: string;
  firmId: string;
  userId: string;
  conversationId: string;
  onProposal: (card: ActionCardData) => void;
}): ChatToolContext {
  let files: Promise<ChatFileRow[]> | null = null;
  return {
    ...opts,
    getFiles: () => {
      files ??= fetchChatFiles(opts.sb, opts.engagementId);
      return files;
    },
  };
}

// Executes one tool call. Always returns a JSON-able value; errors are
// returned as { error } so the model can recover instead of the turn dying.
export async function runChatTool(
  name: string,
  input: unknown,
  ctx: ChatToolContext,
): Promise<unknown> {
  try {
    switch (name) {
      case "get_engagement_overview":
        return await overview(ctx);
      case "list_checklist_items":
        return await checklist(ctx);
      case "search_documents":
        return searchFiles(await ctx.getFiles(), sanitizeCriteria(input));
      case "get_document_details": {
        const fileId =
          typeof (input as { file_id?: unknown })?.file_id === "string"
            ? ((input as { file_id: string }).file_id)
            : null;
        if (!fileId) return { error: "file_id is required" };
        const rows = await ctx.getFiles();
        const row = rows.find((r) => r.id === fileId);
        // Only files of THIS engagement are ever in `rows`, so an id from
        // anywhere else simply doesn't resolve.
        if (!row) return { error: "No document with that file_id in this engagement." };
        return compactFileDetails(row);
      }
      case "get_recent_activity": {
        const raw = (input as { limit?: unknown })?.limit;
        const limit =
          typeof raw === "number" && Number.isFinite(raw)
            ? Math.min(Math.max(Math.round(raw), 1), 50)
            : 20;
        const entries = await fetchChatActivity(ctx.sb, ctx.engagementId, limit);
        return {
          entries: entries.map((e) => ({
            action: e.action,
            actor: e.actor_type,
            at: e.created_at,
            // ids/enums only — the log stores no PII (repo rule).
            meta: e.metadata,
          })),
        };
      }
      case "list_team_members": {
        const members = await listActiveFirmUsers();
        return {
          members: members.map((m) => ({
            user_id: m.id,
            name: userDisplayLabel(m),
            role: m.role,
          })),
        };
      }
      default: {
        if (name.startsWith("propose_")) {
          return await runProposalTool(name, input, ctx);
        }
        return { error: `Unknown tool: ${name}` };
      }
    }
  } catch (err) {
    console.error(`[engagement-chat] tool ${name} failed:`, err);
    return { error: "Lookup failed. Answer from what you already have, or say you couldn't check." };
  }
}

// A propose_* tool call: validate the model's input, enrich it against real
// state, persist the pending action, push the confirm card to the panel, and
// tell the model it is now WAITING on the human. No side effects here.
async function runProposalTool(
  name: string,
  input: unknown,
  ctx: ChatToolContext,
): Promise<unknown> {
  const type = name.slice("propose_".length);
  const parsed = parseActionInput(type, input);
  if (!parsed.ok) return { error: parsed.error };

  const proposal = await buildActionProposal(parsed.type, parsed.input, {
    sb: ctx.sb,
    engagementId: ctx.engagementId,
  });
  if (!proposal.ok) return { error: proposal.error };

  const row = await createPendingAction({
    firmId: ctx.firmId,
    engagementId: ctx.engagementId,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    type: parsed.type,
    payload: proposal.payload,
  });
  if (row === CHAT_SCHEMA_MISSING) {
    return {
      error:
        "Actions aren't activated on this account yet (a database update is pending). Answer questions normally and tell the accountant actions will be available soon.",
    };
  }

  ctx.onProposal(toCard(row, { includeToken: true, nowMs: Date.now() }));
  return {
    status: "proposed",
    note: "A confirm card is now shown to the accountant. NOTHING has been executed. Do not claim the action happened; say it is waiting for their Confirm.",
  };
}

function sanitizeCriteria(input: unknown): SearchCriteria {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: SearchCriteria = {};
  if (typeof raw.vendor === "string" && raw.vendor.trim()) out.vendor = raw.vendor;
  if (typeof raw.amount === "number" && Number.isFinite(raw.amount)) out.amount = raw.amount;
  if (
    typeof raw.amount_tolerance === "number" &&
    Number.isFinite(raw.amount_tolerance) &&
    raw.amount_tolerance >= 0
  ) {
    out.amount_tolerance = raw.amount_tolerance;
  }
  if (typeof raw.doc_type === "string" && raw.doc_type.trim()) out.doc_type = raw.doc_type;
  if (raw.status === "pending" || raw.status === "approved" || raw.status === "rejected") {
    out.status = raw.status;
  }
  if (raw.flagged_only === true) out.flagged_only = true;
  if (typeof raw.year === "number" && Number.isFinite(raw.year)) out.year = raw.year;
  if (typeof raw.text === "string" && raw.text.trim()) out.text = raw.text;
  return out;
}

async function overview(ctx: ChatToolContext) {
  const [engagement, items, files] = await Promise.all([
    fetchChatEngagement(ctx.sb, ctx.engagementId),
    fetchChatItems(ctx.sb, ctx.engagementId),
    ctx.getFiles(),
  ]);
  if (!engagement) return { error: "Engagement not found." };

  const [clientName, assignee, payment] = await Promise.all([
    fetchClientName(ctx.sb, engagement.client_id),
    engagement.assigned_user_id
      ? fetchUserLabel(ctx.sb, engagement.assigned_user_id)
      : Promise.resolve(null),
    fetchLatestPayment(ctx.sb, ctx.engagementId),
  ]);

  const collection = items.filter((i) => i.kind !== "signature");
  const byStatus = (s: string) => collection.filter((i) => i.status === s).length;
  const missingRequired = collection.filter(
    (i) => i.required && (i.status === "pending" || i.status === "rejected"),
  );

  const lastUpload = files.length > 0 ? files[0].uploaded_at : null;

  return {
    title: engagement.title,
    client: clientName,
    status: engagement.status,
    due_date: engagement.due_date,
    sent_at: engagement.sent_at,
    completed_at: engagement.completed_at,
    assignee,
    reminders_paused: engagement.reminders_paused === true,
    checklist: {
      total: collection.length,
      pending: byStatus("pending"),
      submitted: byStatus("submitted"),
      approved: byStatus("approved"),
      rejected: byStatus("rejected"),
      not_applicable: byStatus("na"),
      missing_required: missingRequired.map((i) => ({
        label: i.label,
        label_fr: i.label_fr,
        status: i.status,
      })),
    },
    signatures: items
      .filter((i) => i.kind === "signature")
      .map((i) => ({ label: i.label, status: i.status })),
    documents: {
      total: files.length,
      flagged: files.filter(isFlagged).length,
      last_upload_at: lastUpload,
    },
    latest_payment: payment
      ? {
          status: payment.status,
          amount: payment.amount_cents / 100,
          currency: payment.currency ?? "cad",
          requested_at: payment.created_at,
        }
      : null,
  };
}

async function checklist(ctx: ChatToolContext) {
  const [items, files] = await Promise.all([
    fetchChatItems(ctx.sb, ctx.engagementId),
    ctx.getFiles(),
  ]);
  const filesByItem = new Map<string, number>();
  for (const f of files) {
    if (!f.request_item_id) continue;
    filesByItem.set(f.request_item_id, (filesByItem.get(f.request_item_id) ?? 0) + 1);
  }
  return {
    items: items.map((i) => ({
      item_id: i.id,
      label: i.label,
      label_fr: i.label_fr,
      kind: i.kind ?? "collection",
      doc_type: i.doc_type,
      required: i.required,
      status: i.status,
      rejection_reason: i.rejection_reason,
      files: filesByItem.get(i.id) ?? 0,
      set_assessment: i.ai_set_assessment
        ? {
            outcome: i.ai_set_assessment.outcome ?? null,
            conclusion_en: i.ai_set_assessment.conclusion_en ?? null,
            conclusion_fr: i.ai_set_assessment.conclusion_fr ?? null,
            flags: i.ai_set_assessment.flags ?? [],
          }
        : null,
    })),
  };
}
