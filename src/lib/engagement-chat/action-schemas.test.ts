import { describe, expect, it } from "vitest";
import { ACTION_TYPES, parseActionInput } from "./action-schemas";

const FILE_ID = "0b7e10a4-93c6-4b9a-8f2e-2f9f6a3d1c55";
const ITEM_ID = "1c8f21b5-a4d7-4c0b-9a3f-3a0a7b4e2d66";
const USER_ID = "2d9a32c6-b5e8-4d1c-8b40-4b1b8c5f3e77";

describe("parseActionInput", () => {
  it("rejects unknown action types", () => {
    const r = parseActionInput("delete_engagement", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Unknown action type");
  });

  it("covers every declared action type", () => {
    // Guard against a new type being added without a schema.
    for (const type of ACTION_TYPES) {
      expect(() => parseActionInput(type, {})).not.toThrow();
    }
  });

  it("approve/reject need a uuid file_id", () => {
    expect(parseActionInput("approve_document", { file_id: FILE_ID }).ok).toBe(true);
    expect(parseActionInput("approve_document", { file_id: "nope" }).ok).toBe(false);
    expect(parseActionInput("approve_document", {}).ok).toBe(false);
  });

  it("reject enforces the 2-500 char client-facing reason (matches the reject routes)", () => {
    const ok = parseActionInput("reject_document", {
      file_id: FILE_ID,
      reason: "Pages 2 à 6 manquantes",
    });
    expect(ok.ok).toBe(true);
    expect(
      parseActionInput("reject_document", { file_id: FILE_ID, reason: "x" }).ok,
    ).toBe(false);
    expect(
      parseActionInput("reject_document", {
        file_id: FILE_ID,
        reason: "y".repeat(501),
      }).ok,
    ).toBe(false);
  });

  it("send_reminder takes no arguments and rejects extras", () => {
    expect(parseActionInput("send_reminder", {}).ok).toBe(true);
    expect(parseActionInput("send_reminder", undefined).ok).toBe(true);
    expect(parseActionInput("send_reminder", { engagement_id: "x" }).ok).toBe(false);
  });

  it("add item validates the doc_type against the canonical list", () => {
    expect(
      parseActionInput("add_checklist_item", { label: "Relevé bancaire" }).ok,
    ).toBe(true);
    expect(
      parseActionInput("add_checklist_item", {
        label: "Relevé",
        doc_type: "bank_statement",
      }).ok,
    ).toBe(true);
    expect(
      parseActionInput("add_checklist_item", {
        label: "Relevé",
        doc_type: "banana",
      }).ok,
    ).toBe(false);
  });

  it("edit item requires at least one change", () => {
    expect(parseActionInput("edit_checklist_item", { item_id: ITEM_ID }).ok).toBe(false);
    expect(
      parseActionInput("edit_checklist_item", {
        item_id: ITEM_ID,
        required: false,
      }).ok,
    ).toBe(true);
    expect(
      parseActionInput("edit_checklist_item", {
        item_id: ITEM_ID,
        new_label: "T4 2025",
      }).ok,
    ).toBe(true);
  });

  it("due date accepts YYYY-MM-DD or null, rejects garbage", () => {
    expect(parseActionInput("change_due_date", { due_date: "2026-09-30" }).ok).toBe(true);
    expect(parseActionInput("change_due_date", { due_date: null }).ok).toBe(true);
    expect(parseActionInput("change_due_date", { due_date: "next week" }).ok).toBe(false);
    expect(parseActionInput("change_due_date", { due_date: "2026-13-45" }).ok).toBe(false);
    expect(parseActionInput("change_due_date", {}).ok).toBe(false);
  });

  it("assignee requires a uuid user_id", () => {
    expect(parseActionInput("change_assignee", { user_id: USER_ID }).ok).toBe(true);
    expect(parseActionInput("change_assignee", { user_id: "zach" }).ok).toBe(false);
  });

  it("strict schemas reject unexpected extra fields (model can't smuggle params)", () => {
    expect(
      parseActionInput("approve_document", {
        file_id: FILE_ID,
        engagement_id: "3e0b43d7-c6f9-4e2d-9c51-5c2c9d604f88",
      }).ok,
    ).toBe(false);
  });
});
