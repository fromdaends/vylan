// The engagement chat's READ tools (phase 2 — no side effects anywhere).
// Definitions follow Anthropic's tool schema; execution is dispatched by
// name with the engagement id bound server-side. Phase 3 adds the
// propose-only action tools alongside these.

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
];

export type ChatToolContext = {
  sb: SupabaseClient;
  engagementId: string;
  // Memoized files fetch — several tools read the same rows per turn.
  getFiles: () => Promise<ChatFileRow[]>;
};

export function createChatToolContext(
  sb: SupabaseClient,
  engagementId: string,
): ChatToolContext {
  let files: Promise<ChatFileRow[]> | null = null;
  return {
    sb,
    engagementId,
    getFiles: () => {
      files ??= fetchChatFiles(sb, engagementId);
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
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[engagement-chat] tool ${name} failed:`, err);
    return { error: "Lookup failed. Answer from what you already have, or say you couldn't check." };
  }
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
