// Engagement chat — every tunable in ONE place (founder spec: both rate-limit
// values must be single named constants changeable in one line).

// The product rate limit: how many user-sent messages (each = one model call)
// a single user gets inside the rolling window, across all engagements.
// Confirm/Cancel taps on future action cards do NOT count — they never hit
// the model. Enforced SERVER-SIDE from the chat_messages table.
export const CHAT_MESSAGE_LIMIT = 30;
export const CHAT_WINDOW_HOURS = 36;

// The chat model. Haiku: the answers are grounded in tool lookups against
// the engagement's structured data, and every future action is human-
// confirmed, so the cheap tier is deliberate (founder decision 2026-07-10).
// The document CHECKER's model lives elsewhere (src/lib/ai/classify.ts) and
// must NOT be downgraded — this constant is only the conversation brain.
export const CHAT_MODEL = "claude-haiku-4-5";

// Reply budget. Short, focused answers — same philosophy as the help
// assistant's 700, slightly higher for answers that enumerate documents.
export const CHAT_MAX_TOKENS = 800;

// Tool-use loop bound: one question rarely needs more than 2-3 lookups; 5
// keeps a confused loop from burning tokens.
export const CHAT_MAX_TOOL_ROUNDS = 5;

// How much history the model sees per turn (messages, newest last) and how
// large a single user message may be.
export const CHAT_HISTORY_MESSAGES = 20;
export const CHAT_MAX_MESSAGE_CHARS = 2000;

// How many rows a document search returns to the model (the executor also
// reports the total match count so the model can say "and N more").
export const CHAT_SEARCH_RESULT_CAP = 20;

// How many persisted messages the history endpoint returns to the panel.
export const CHAT_HISTORY_FETCH_LIMIT = 50;

// Upstash backstop (fails open when unconfigured, like every other limit in
// src/lib/rate-limit.ts). The DB window above is the product limit; this only
// caps a whole firm's daily burn if many seats hammer the endpoint at once.
export const CHAT_PER_FIRM_DAILY = { limit: 500, window: "1 d" as const };

// ---------------------------------------------------------------------------
// Actions (phase 3 — propose-and-confirm)
// ---------------------------------------------------------------------------

// How long a proposed action's confirm card stays actionable. Past this the
// card renders as expired and the confirm endpoint refuses the token.
export const ACTION_EXPIRY_MINUTES = 15;

// "Send a reminder now" guard: refuse a new manual reminder if one was sent
// within this window (the existing button has no cooldown; the chat action
// gets one so a chatty session can't accidentally spam the client).
export const REMINDER_COOLDOWN_HOURS = 1;

// How many recent action proposals are summarized into the system prompt so
// the model knows what was confirmed/cancelled on earlier turns.
export const ACTION_CONTEXT_COUNT = 8;
