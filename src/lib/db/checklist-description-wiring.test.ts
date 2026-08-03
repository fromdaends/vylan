import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateEngagementInput } from "./engagements";

// WIRING tests for the two ways a checklist item is born.
//
// src/lib/engagements/request-item-row.test.ts already proves the shared
// buildRequestItemRow mirrors a one-sided description into both columns. That
// is NOT enough on its own: the original bug (#1166) was not in a helper, it
// was in the WIRING — createEngagementWithItems passed `item.description_en`,
// which the engagement builder never assigns, so the English column was always
// null and English portal clients saw no instructions.
//
// Revert either call site to hand-build its row again and every unit test on
// the helper still passes. These tests capture what actually reaches
// `.insert()`, so that regression cannot come back quietly.

type Row = Record<string, unknown>;
const captured: Record<string, Row[]> = {};

function makeSupabase() {
  const table = (name: string) => {
    const api: Record<string, unknown> = {};
    const result = (data: unknown) => ({ data, error: null });
    const rowFor = (t: string) =>
      t === "users"
        ? { id: "u1", firm_id: "f1", role: "staff" }
        : t === "engagements"
          ? { id: "eng-1" }
          : null;

    api.select = () => api;
    api.eq = () => api;
    api.order = () => api;
    api.limit = () => api;
    api.single = async () => result(rowFor(name));
    // getCurrentUser (which createEngagementWithItems now rides for its
    // auth + users-row read) uses .maybeSingle(), so it must answer with
    // the same rows .single() does — null here reads as "not authenticated".
    api.maybeSingle = async () => result(rowFor(name));
    api.insert = (rows: Row | Row[]) => {
      captured[name] = (captured[name] ?? []).concat(
        Array.isArray(rows) ? rows : [rows],
      );
      // Awaitable directly (the request_items insert) AND chainable into
      // .select().single() (the engagements insert). One object does both.
      const res = result(rowFor(name));
      const p = Promise.resolve(res) as Promise<typeof res> & {
        select?: () => unknown;
        single?: () => Promise<typeof res>;
      };
      p.select = () => p;
      p.single = async () => res;
      return p;
    };
    return api;
  };

  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (name: string) => table(name),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => makeSupabase(),
}));
vi.mock("@/lib/engagements/stage-sync", () => ({
  syncEngagementStage: async () => undefined,
}));
vi.mock("./file-review", () => ({ setAllFilesReviewForItem: async () => undefined }));

beforeEach(() => {
  for (const k of Object.keys(captured)) delete captured[k];
});

const BASE_ENGAGEMENT: Omit<CreateEngagementInput, "items"> = {
  client_id: "c1",
  title: "2026 personal tax",
  type: "t1",
  due_date: null,
  ai_enabled: true,
  reminder_settings: { enabled: false, steps: [] },
};

describe("createEngagementWithItems — the checklist it actually writes", () => {
  it("stores a NON-NULL English description for an item created with the engagement", async () => {
    // THE REGRESSION. The engagement builder has ONE description box and fills
    // description_fr only; description_en is seeded null and never assigned.
    // Before #1166 this wrote `description: null` and an English-speaking
    // client saw a blank where their instructions should be.
    const { createEngagementWithItems } = await import("./engagements");
    await createEngagementWithItems({
      ...BASE_ENGAGEMENT,
      items: [
        {
          label_fr: "Relevé 1",
          label_en: "",
          description_fr: "Envoyez le feuillet complet",
          description_en: null,
          doc_type: "rl1",
          required: true,
        },
      ],
    });

    const rows = captured["request_items"] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Envoyez le feuillet complet");
    expect(rows[0]!.description_fr).toBe("Envoyez le feuillet complet");
    // The label had the same shape of problem and must not regress either.
    expect(rows[0]!.label).toBe("Relevé 1");
  });

  it("does not overwrite a real English description when both are given", async () => {
    const { createEngagementWithItems } = await import("./engagements");
    await createEngagementWithItems({
      ...BASE_ENGAGEMENT,
      items: [
        {
          label_fr: "Relevé 1",
          label_en: "RL-1 slip",
          description_fr: "Envoyez le feuillet complet",
          description_en: "Send the whole slip",
          doc_type: "rl1",
          required: true,
        },
      ],
    });

    const row = (captured["request_items"] ?? [])[0]!;
    expect(row.description).toBe("Send the whole slip");
    expect(row.description_fr).toBe("Envoyez le feuillet complet");
  });

  it("leaves both columns null when the firm wrote no instructions", async () => {
    // A description is optional. The portal renders that block only when there
    // is text, so absent must stay absent rather than becoming "".
    const { createEngagementWithItems } = await import("./engagements");
    await createEngagementWithItems({
      ...BASE_ENGAGEMENT,
      items: [
        {
          label_fr: "Feuillet T4",
          label_en: "T4 slip",
          doc_type: "t4",
          required: true,
        },
      ],
    });

    const row = (captured["request_items"] ?? [])[0]!;
    expect(row.description).toBeNull();
    expect(row.description_fr).toBeNull();
  });

  it("keeps the checklist in the order the firm wrote it", async () => {
    const { createEngagementWithItems } = await import("./engagements");
    await createEngagementWithItems({
      ...BASE_ENGAGEMENT,
      items: [
        { label_fr: "Un", label_en: "", doc_type: "t4", required: true },
        { label_fr: "Deux", label_en: "", doc_type: "t5", required: false },
      ],
    });

    const rows = captured["request_items"] ?? [];
    expect(rows.map((r) => r.order_index)).toEqual([0, 1]);
    expect(rows.map((r) => r.label)).toEqual(["Un", "Deux"]);
  });
});

describe("addItemToEngagement — the other way an item is born", () => {
  it("also stores a non-null English description", async () => {
    // This path was already correct before #1166 (it mirrored one textarea into
    // both columns by hand). Pinned so the two paths cannot drift apart again
    // from the other direction.
    const { addItemToEngagement } = await import("./request-items");
    await addItemToEngagement({
      engagement_id: "eng-1",
      label: "T4 slip",
      description: "Send the whole slip",
      doc_type: "t4",
      required: true,
    });

    const row = (captured["request_items"] ?? [])[0]!;
    expect(row.description).toBe("Send the whole slip");
    expect(row.description_fr).toBe("Send the whole slip");
  });

  it("mirrors a French-only description added later, too", async () => {
    const { addItemToEngagement } = await import("./request-items");
    await addItemToEngagement({
      engagement_id: "eng-1",
      label: "Relevé 1",
      description_fr: "Envoyez le feuillet complet",
      doc_type: "rl1",
      required: true,
    });

    const row = (captured["request_items"] ?? [])[0]!;
    expect(row.description).toBe("Envoyez le feuillet complet");
    expect(row.description_fr).toBe("Envoyez le feuillet complet");
  });

  it("still marks a newly added item pending", async () => {
    const { addItemToEngagement } = await import("./request-items");
    await addItemToEngagement({
      engagement_id: "eng-1",
      label: "T4 slip",
      doc_type: "t4",
      required: true,
    });

    expect((captured["request_items"] ?? [])[0]!.status).toBe("pending");
  });
});

describe("the two paths agree", () => {
  it("writes the same description columns for the same one-sided input", async () => {
    // The whole point of the shared builder. If these ever disagree, one of the
    // two call sites has stopped using it.
    const { createEngagementWithItems } = await import("./engagements");
    const { addItemToEngagement } = await import("./request-items");

    await createEngagementWithItems({
      ...BASE_ENGAGEMENT,
      items: [
        {
          label_fr: "Relevé 1",
          label_en: "",
          description_fr: "Envoyez le feuillet",
          doc_type: "rl1",
          required: true,
        },
      ],
    });
    const atCreation = (captured["request_items"] ?? [])[0]!;

    for (const k of Object.keys(captured)) delete captured[k];
    await addItemToEngagement({
      engagement_id: "eng-1",
      label: "Relevé 1",
      description_fr: "Envoyez le feuillet",
      doc_type: "rl1",
      required: true,
    });
    const addedLater = (captured["request_items"] ?? [])[0]!;

    expect(atCreation.description).toBe(addedLater.description);
    expect(atCreation.description_fr).toBe(addedLater.description_fr);
    expect(atCreation.label).toBe(addedLater.label);
    expect(atCreation.label_fr).toBe(addedLater.label_fr);
  });
});
