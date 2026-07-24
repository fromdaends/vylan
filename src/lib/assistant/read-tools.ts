// Firm-wide READ tools for the general "Vylan" assistant (POST /api/assistant).
//
// The general assistant has no bound engagement (there is no engagement
// selector — it is fully general). So unlike the engagement chat, whose read
// tools operate on one fixed engagement, these take an explicit engagement_id
// the model gets from find_engagements first. The actual lookups reuse the
// engagement-chat read executors (runChatTool) and data layer verbatim — this
// module only adds firm-wide discovery + the engagement_id plumbing. Nothing
// here can mutate anything: there are no propose_* tools, and a propose_* name
// is refused defensively.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createChatToolContext,
  runChatTool,
  type ChatToolContext,
} from "@/lib/engagement-chat/tools";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The tools the general assistant may call. find_engagements discovers the
// firm's work; the rest read ONE engagement identified by engagement_id.
export const ASSISTANT_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_engagements",
    description:
      "Find engagements across the whole firm by client name, engagement title, or status. Returns matches with their engagement_id, title, client, and status. Call this FIRST to get an engagement_id before any other tool, and to answer \"which engagements…\" questions. Omit query to list the most recent engagements.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Client name, engagement title, or free text to match (case-insensitive). Omit to list the most recent engagements.",
        },
        status: {
          type: "string",
          description:
            "Optional exact status filter, e.g. draft, sent, in_progress, complete, cancelled.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_engagement_overview",
    description:
      "Status snapshot of ONE engagement: title, client, status, due date, assignee, checklist counts by status, signature items, latest payment request, and when the client last uploaded. Call this first for broad questions like \"where does this stand?\" or \"what's still missing?\". Get engagement_id from find_engagements.",
    input_schema: {
      type: "object",
      properties: {
        engagement_id: {
          type: "string",
          description: "The engagement_id from a find_engagements result.",
        },
      },
      required: ["engagement_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_checklist_items",
    description:
      "Every checklist item of the engagement with its status (pending / submitted / approved / rejected / na), whether it's required, its rejection reason, and the AI page-completeness verdict when one exists. Use for \"what's missing\", \"what got rejected\", or anything item-level. Get engagement_id from find_engagements.",
    input_schema: {
      type: "object",
      properties: {
        engagement_id: {
          type: "string",
          description: "The engagement_id from a find_engagements result.",
        },
      },
      required: ["engagement_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_documents",
    description:
      "Search an engagement's uploaded documents by any combination of filters over the structured data the AI extracted at upload (never the raw files). Returns compact matches plus the total count. Omit every filter except engagement_id to list all documents. Get engagement_id from find_engagements.",
    input_schema: {
      type: "object",
      properties: {
        engagement_id: {
          type: "string",
          description: "The engagement_id from a find_engagements result.",
        },
        vendor: {
          type: "string",
          description:
            "Vendor / issuer / person name, e.g. \"Staples\" or \"Hydro-Québec\". Accent- and case-insensitive.",
        },
        amount: {
          type: "number",
          description:
            "A dollar amount that appears on the document. Matched to the cent unless amount_tolerance is given.",
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
      required: ["engagement_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_document_details",
    description:
      "Everything extracted from ONE document: identifiers, labelled amounts, usability verdict (with the client-facing summary), rejection info, and the receipt/invoice transaction breakdown when present. Use after search_documents when a question needs the fine detail.",
    input_schema: {
      type: "object",
      properties: {
        engagement_id: {
          type: "string",
          description: "The engagement_id the document belongs to.",
        },
        file_id: {
          type: "string",
          description: "The file_id from a search_documents result.",
        },
      },
      required: ["engagement_id", "file_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_activity",
    description:
      "An engagement's recent activity log entries (uploads, approvals, rejections, reminders, payments, signatures, AI verdicts), newest first. Use for \"when did the client last do X\" or \"what happened recently\". Get engagement_id from find_engagements.",
    input_schema: {
      type: "object",
      properties: {
        engagement_id: {
          type: "string",
          description: "The engagement_id from a find_engagements result.",
        },
        limit: {
          type: "number",
          description: "How many entries (default 20, max 50).",
        },
      },
      required: ["engagement_id"],
      additionalProperties: false,
    },
  },
];

type Row = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  // PostgREST embeds a many-to-one relation as a single object (or null).
  clients: { display_name: string | null } | null;
};

// find_engagements — firm-wide discovery. RLS scopes the select to the caller's
// firm; the optional query filters client name / title client-side (the same
// active-scope list the engagements board and the old panel selector showed).
async function findEngagements(
  sb: SupabaseClient,
  input: unknown,
): Promise<unknown> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const query =
    typeof raw.query === "string" ? raw.query.trim().toLowerCase() : "";
  const status = typeof raw.status === "string" ? raw.status.trim() : "";

  let q = sb
    .from("engagements")
    .select("id, title, status, created_at, clients(display_name)")
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return { error: "Could not list engagements." };

  let rows = ((data ?? []) as unknown as Row[]).map((r) => ({
    engagement_id: r.id,
    title: r.title,
    status: r.status,
    client: r.clients?.display_name ?? null,
  }));
  if (query) {
    rows = rows.filter(
      (r) =>
        r.title?.toLowerCase().includes(query) ||
        r.client?.toLowerCase().includes(query),
    );
  }
  return { engagements: rows.slice(0, 25), total: rows.length };
}

function readEngagementId(input: unknown): string | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  return typeof raw.engagement_id === "string" && UUID_RE.test(raw.engagement_id)
    ? raw.engagement_id
    : null;
}

export type AssistantReadContext = {
  sb: SupabaseClient;
  firmId: string;
  // One memoized read context per engagement touched this turn (getFiles caches
  // per engagement, so repeated tools on the same engagement share one fetch).
  ctxByEngagement: Map<string, ChatToolContext>;
};

export function createAssistantReadContext(opts: {
  sb: SupabaseClient;
  firmId: string;
}): AssistantReadContext {
  return { ...opts, ctxByEngagement: new Map() };
}

// Execute one read tool. find_engagements is firm-wide; every other tool reads
// ONE engagement, whose read executor is the engagement chat's runChatTool
// bound to a read-only context (no proposal wiring). Errors come back as
// { error } so the model can recover instead of the turn dying.
export async function runAssistantReadTool(
  name: string,
  input: unknown,
  ctx: AssistantReadContext,
): Promise<unknown> {
  if (name === "find_engagements") return findEngagements(ctx.sb, input);
  // Defensive: the general assistant is read-only and is never given
  // propose_* tools, but never execute one even if a name slips through.
  if (name.startsWith("propose_")) {
    return {
      error:
        "Actions are disabled. You can look things up and summarize, but you cannot change anything.",
    };
  }

  const engagementId = readEngagementId(input);
  if (!engagementId) {
    return {
      error:
        "engagement_id is required. Call find_engagements first to get one.",
    };
  }

  let toolCtx = ctx.ctxByEngagement.get(engagementId);
  if (!toolCtx) {
    toolCtx = createChatToolContext({
      sb: ctx.sb,
      engagementId,
      firmId: ctx.firmId,
      // Read-only: userId / conversationId / onProposal / autoConfirm are only
      // used by the propose_* path, which this assistant never reaches.
      userId: "",
      conversationId: "",
      onProposal: () => {},
      autoConfirm: false,
    });
    ctx.ctxByEngagement.set(engagementId, toolCtx);
  }
  return runChatTool(name, input, toolCtx);
}
