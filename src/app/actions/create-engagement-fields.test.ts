import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A field accepted by the action's schema must actually REACH the database.
//
// ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
//
// createEngagementAction validated `proposal`, and the object it then handed to
// createEngagementWithItems left it out. So the frozen proposal was never
// written, `requires_acceptance` was never true, and every surface gated on that
// flag was unreachable in production: the client got the old "we need a few
// documents" email, the portal showed a document checklist instead of the
// contract, nothing could be accepted, and therefore no deposit ever gated
// anything and no recurring schedule ever started.
//
// Nothing errored. The field was dropped on the floor between a schema that
// accepted it and a database that never heard of it — and tsc CANNOT catch it,
// because every field on CreateEngagementInput is optional, so omitting one is
// a perfectly valid object.
//
// ── WHY A SOURCE SCAN AND NOT A BEHAVIOURAL TEST ───────────────────────────
//
// The honest alternative is standing up the whole action behind mocks for
// Supabase, auth, the firm, limits, tasks, workflows, reminders, invoices and
// email — a large amount of scaffolding whose failure modes are its own. This
// asks the one question that actually failed ("does the create input mention
// this field at all?") directly, cheaply, and without a fixture to rot.
//
// It is deliberately a WEAK check: presence, not correctness. A weak check on
// the thing that broke beats a strong check on the things that did not.

const ACTION = readFileSync(
  join(process.cwd(), "src/app/actions/engagements.ts"),
  "utf8",
);

/** The `const input: CreateEngagementInput = { ... }` literal, as text. */
function createInputBlock(): string {
  const start = ACTION.indexOf("const input: CreateEngagementInput = {");
  expect(start).toBeGreaterThan(-1);
  const end = ACTION.indexOf(
    "await createEngagementWithItems(input)",
    start,
  );
  expect(end).toBeGreaterThan(start);
  return ACTION.slice(start, end);
}

describe("createEngagementAction carries every field it accepts", () => {
  const input = createInputBlock();

  // Each of these is a field the builder sends and the schema validates. Every
  // one of them silently doing nothing is a shipped feature that does not exist.
  const MUST_REACH_THE_DATABASE = [
    // The frozen contract. THIS is the one that was missing.
    "proposal",
    // What gets CHARGED on acceptance — a number in the jsonb cannot be billed.
    "deposit_cents",
    "client_id",
    "title",
    "service_items",
    "start_date",
    "intro_message",
    "invoice_auto_mode",
    "invoice_amount_cents",
    "reminder_settings",
  ];

  for (const field of MUST_REACH_THE_DATABASE) {
    it(`passes \`${field}\` to createEngagementWithItems`, () => {
      expect(input).toMatch(new RegExp(`\\b${field}\\s*:`));
    });
  }

  it("still hands the input to createEngagementWithItems", () => {
    // If this ever fails the scan above is measuring nothing, and the whole
    // file must be re-pointed rather than deleted.
    expect(ACTION).toContain("await createEngagementWithItems(input)");
  });
});

describe("createEngagementWithItems turns a proposal into an agreement", () => {
  const DB = readFileSync(
    join(process.cwd(), "src/lib/db/engagements.ts"),
    "utf8",
  );

  it("sets requires_acceptance from the proposal, not from anything else", () => {
    // The flag every proposal surface branches on is DERIVED. If this stops
    // being true, a proposal could be stored and still never be presented.
    expect(DB).toMatch(
      /input\.proposal[\s\S]{0,120}requires_acceptance:\s*true/,
    );
  });
});
