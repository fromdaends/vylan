// AI drafting for flows — the founder's ask: "build an entire AI chat where
// you could actually just build automations and [have] AI create them for
// you." The AI DRAFTS; a human reviews the draft in the same AutomationEditor
// everything else uses and explicitly saves it — nothing the model produces
// ever touches the library on its own (the propose-approve doctrine, expressed
// as component state instead of a pending-actions table, because an unsaved
// draft IS the proposal).
//
// SERVER-ONLY (Anthropic SDK). One forced tool call, no streaming — the output
// is a structured object, not prose. The model speaks a DELIBERATELY SIMPLER
// dialect than WorkflowDefinition (assignee "none" instead of null, a
// top-level send_letter boolean instead of a stage action, snake_case chase
// fields) and assembly + parseWorkflowDefinition translate it; the total
// parser is the safety gate, so a hallucinated shape degrades instead of
// saving garbage. parseDraftPayload is pure and exported for tests.

import type Anthropic from "@anthropic-ai/sdk";
import {
  assistantClient,
  isAssistantConfigured,
  ASSISTANT_MODEL,
} from "@/lib/ai/assistant";
import {
  ADVANCE_CONDITIONS,
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "./definition";
import { flowSendsLetter, withFlowLetter } from "./plan";
import {
  CHASE_INTERVAL_MAX,
  CHASE_INTERVAL_MIN,
  CHASE_MAX_MAX,
  CHASE_MAX_MIN,
} from "@/lib/invoices/chase-settings";
import { ENGAGEMENT_STAGES } from "@/lib/engagements/stage";

// Six mandatory stage objects plus bilingual task titles add up; 3000 leaves
// real headroom, and a response that still hits the cap is reported as a
// distinct failure below rather than parsed off a truncated JSON.
const DRAFT_MAX_TOKENS = 3000;

// The letter is NOT offered as a stage action (it fires at send, flow-level);
// the model gets a send_letter boolean instead. Same reason the editor's
// per-stage row dropped it.
const DRAFT_STAGE_ACTIONS = [
  "activate_checklist",
  "send_invoice",
  "notify_assignee",
] as const;

const STAGE_SCHEMA = {
  type: "object" as const,
  properties: {
    skipped: { type: "boolean" as const },
    assignee: { type: "string" as const, enum: ["owner", "staff", "none"] },
    on_entry: {
      type: "array" as const,
      items: { type: "string" as const, enum: [...DRAFT_STAGE_ACTIONS] },
    },
    tasks: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          title_en: { type: "string" as const },
          title_fr: { type: "string" as const },
        },
        required: ["title_en", "title_fr"],
      },
    },
    advance: {
      type: "object" as const,
      properties: {
        condition: {
          type: "string" as const,
          enum: [...ADVANCE_CONDITIONS],
        },
        mode: { type: "string" as const, enum: ["automatic", "confirm"] },
      },
      required: ["condition", "mode"],
    },
  },
  required: ["skipped", "assignee", "on_entry", "tasks"],
};

export const DRAFT_FLOW_TOOL: Anthropic.Tool = {
  name: "draft_flow",
  description:
    "Return the drafted workflow (flow) for the accounting firm. Every stage must be present.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "A short name for the flow, in the user's language.",
      },
      summary_en: {
        type: "string",
        description: "One plain-English sentence describing what the flow does.",
      },
      summary_fr: {
        type: "string",
        description: "The same sentence in French.",
      },
      send_letter: {
        type: "boolean",
        description:
          "Whether the engagement letter goes out for signature when the engagement is sent to the client.",
      },
      stages: {
        type: "object",
        properties: Object.fromEntries(
          ENGAGEMENT_STAGES.map((s) => [s, STAGE_SCHEMA]),
        ),
        required: [...ENGAGEMENT_STAGES],
      },
      invoice_chase: {
        type: "object",
        description:
          "Only when the user asked about invoice reminders. Omit to follow the firm default.",
        properties: {
          enabled: { type: "boolean" },
          interval_days: {
            type: "integer",
            minimum: CHASE_INTERVAL_MIN,
            maximum: CHASE_INTERVAL_MAX,
          },
          max_reminders: {
            type: "integer",
            minimum: CHASE_MAX_MIN,
            maximum: CHASE_MAX_MAX,
          },
        },
        required: ["enabled"],
      },
    },
    required: ["name", "summary_en", "summary_fr", "send_letter", "stages"],
  },
};

const SYSTEM = `You draft workflow "flows" for Vylan, practice-management software for Canadian accounting firms. A flow is a per-stage playbook an engagement (a job for one client) runs automatically.

The six stages, in order: collecting (client uploads documents), in_review (firm checks them), in_preparation (firm does the work), awaiting_signature (client signs the finished work), awaiting_payment (client pays), completed. collecting and completed can never be skipped; any other stage can be (skipped: true) when the kind of work doesn't need it.

Per stage you set: who it's handed to (assignee: owner = the firm owner, staff = whoever the engagement is assigned to, none), what fires when it begins (on_entry: activate_checklist turns on the document checklist and its reminders — almost always on collecting; send_invoice raises and emails the invoice; notify_assignee pings the stage's person), team to-dos created at that stage (tasks, bilingual EN/FR titles), and what moves it forward (advance: condition + mode). Conditions: all_docs_verified, signatures_completed, signature_request_sent, invoice_paid, invoice_sent, stage_tasks_done (requires that stage to have tasks), manual. Mode: automatic, or confirm (a human approves the move). The completed stage takes no advance.

The engagement letter is flow-level (send_letter), not a stage action — it goes out for signature the moment the engagement is sent, and the client signing it is what accepts the proposal.

Follow the user's description faithfully. Where they are silent, prefer the conventions above: checklist on collecting with all_docs_verified/automatic, a confirm gate on in_review, invoice near the end. stage_tasks_done only on stages you gave tasks. Keep names short. Answer ONLY by calling draft_flow.`;

export type DraftResult =
  | {
      ok: true;
      name: string;
      summaryEn: string;
      summaryFr: string;
      definition: WorkflowDefinition;
    }
  | { ok: false; reason: "not_configured" | "call_failed" | "bad_draft" };

/** Pure assembly + validation of the model's tool input — exported for tests.
 *  Total: anything malformed returns null rather than throwing. */
export function parseDraftPayload(input: unknown): Omit<
  Extract<DraftResult, { ok: true }>,
  "ok"
> | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 120) : "";
  if (!name) return null;
  const summaryEn =
    typeof r.summary_en === "string" ? r.summary_en.trim().slice(0, 400) : "";
  const summaryFr =
    typeof r.summary_fr === "string" ? r.summary_fr.trim().slice(0, 400) : "";

  // Translate the model dialect into the stored shape; the total parser does
  // all bounding/dropping (unknown actions, bad conditions, skipped guards).
  const stagesRaw =
    r.stages && typeof r.stages === "object"
      ? (r.stages as Record<string, unknown>)
      : {};
  const stages: Record<string, unknown> = {};
  for (const s of ENGAGEMENT_STAGES) {
    const st = (stagesRaw[s] ?? {}) as Record<string, unknown>;
    stages[s] = {
      ...st,
      assignee: st.assignee === "none" ? null : st.assignee,
    };
  }

  const chaseRaw =
    r.invoice_chase && typeof r.invoice_chase === "object"
      ? (r.invoice_chase as Record<string, unknown>)
      : null;
  const assembled = {
    stages,
    ...(chaseRaw
      ? {
          reminders: {
            invoice: {
              enabled: chaseRaw.enabled !== false,
              intervalDays: chaseRaw.interval_days,
              maxReminders: chaseRaw.max_reminders,
            },
          },
        }
      : {}),
  };
  let definition = parseWorkflowDefinition(assembled);
  if (!definition) return null;
  definition = withFlowLetter(definition, r.send_letter === true);
  return { name, summaryEn, summaryFr, definition };
}

export async function draftWorkflowFromDescription(opts: {
  description: string;
  locale: "en" | "fr";
  /** Refining an existing draft: the definition as it stands + what to change. */
  current?: WorkflowDefinition | null;
  instruction?: string | null;
}): Promise<DraftResult> {
  if (!isAssistantConfigured()) return { ok: false, reason: "not_configured" };
  const client = assistantClient();
  if (!client) return { ok: false, reason: "not_configured" };

  const userParts: string[] = [
    `The firm's description of the flow they want (their UI language is ${opts.locale}):\n${opts.description.trim().slice(0, 2000)}`,
  ];
  if (opts.current) {
    // The stored dialect and the tool dialect differ (the letter is a stage
    // entry in storage but a send_letter boolean here; chase is camelCase
    // there, snake_case here). State the flow-level facts IN THE TOOL'S OWN
    // DIALECT and demand they be re-asserted, or an unrelated refinement
    // silently flips the letter off and drops the chase override.
    const inv = opts.current.reminders?.invoice ?? null;
    userParts.push(
      `The current draft, which you should MODIFY rather than restart (JSON):\n${JSON.stringify(opts.current)}`,
      `Current flow-level settings, in your output's terms: send_letter=${flowSendsLetter(opts.current)}; invoice_chase=${
        inv
          ? JSON.stringify({
              enabled: inv.enabled,
              interval_days: inv.intervalDays,
              max_reminders: inv.maxReminders,
            })
          : "not set (firm default)"
      }. Re-state BOTH exactly as they are unless the change request asks to change them.`,
    );
  }
  if (opts.instruction?.trim()) {
    userParts.push(
      `Change request:\n${opts.instruction.trim().slice(0, 1000)}`,
    );
  }

  try {
    const res = await client.messages.create(
      {
        model: ASSISTANT_MODEL,
        max_tokens: DRAFT_MAX_TOKENS,
        system: SYSTEM,
        tools: [DRAFT_FLOW_TOOL],
        tool_choice: { type: "tool", name: "draft_flow" },
        messages: [{ role: "user", content: userParts.join("\n\n") }],
      },
      { timeout: 40_000, maxRetries: 1 },
    );
    // A truncated tool call parses as garbage; say so honestly instead of
    // blaming the user's wording.
    if (res.stop_reason === "max_tokens") {
      console.error("[workflow] AI draft hit the token cap");
      return { ok: false, reason: "bad_draft" };
    }
    const toolUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const parsed = toolUse ? parseDraftPayload(toolUse.input) : null;
    if (!parsed) return { ok: false, reason: "bad_draft" };

    // The tool dialect cannot express the documents cadence at all, and the
    // schema tells the model to omit invoice_chase when the request wasn't
    // about reminders — so on a refine, what the reviewer already set is
    // MERGED back: documents always carries over; the invoice override
    // carries over whenever the model stayed silent.
    if (opts.current) {
      const docs = opts.current.reminders?.documents ?? null;
      const invoice =
        parsed.definition.reminders?.invoice ??
        opts.current.reminders?.invoice ??
        null;
      if (docs || invoice) {
        parsed.definition = {
          ...parsed.definition,
          reminders: { documents: docs, invoice },
        };
      }
    }
    return { ok: true, ...parsed };
  } catch (e) {
    console.error("[workflow] AI draft failed:", e);
    return { ok: false, reason: "call_failed" };
  }
}
