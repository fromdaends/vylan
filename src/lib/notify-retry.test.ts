import { describe, it, expect } from "vitest";
import {
  buildUnusableDocRetryEmail,
} from "./email";
import { buildUnusableDocRetrySms } from "./sms";
import { isAntispamClear, SMS_ANTISPAM_WINDOW_MIN } from "./notify-retry";

// Words that must NEVER appear in client-facing retry messages.
// (Phase 4 spec — the firm should look like they spotted the issue,
// not a robot.)
const FORBIDDEN = ["AI", "AI ", "robot", "Robot", "automatic", "automatique"];

const EMAIL_OPTS = {
  clientName: "Marie",
  firmName: "Cabinet Tremblay",
  requestItemLabel: "T4 — Emploi Inc.",
  issueSummary: "le côté droit du document est coupé",
  retryLink: "https://vylan.app/r/abc123",
} as const;

describe("buildUnusableDocRetryEmail — French", () => {
  const out = buildUnusableDocRetryEmail({ ...EMAIL_OPTS, locale: "fr" });

  it("uses the French subject line with the firm name", () => {
    expect(out.subject).toBe(
      "Action requise — un document à reprendre pour Cabinet Tremblay",
    );
  });

  it("greets the client by name", () => {
    expect(out.text).toMatch(/^Bonjour Marie,/);
    expect(out.html).toContain("Bonjour Marie");
  });

  it("includes the request item label, the specific issue, and the retry link", () => {
    expect(out.text).toContain("T4 — Emploi Inc.");
    expect(out.text).toContain("le côté droit du document est coupé");
    expect(out.text).toContain("https://vylan.app/r/abc123");
    expect(out.html).toContain("https://vylan.app/r/abc123");
  });

  it("never mentions AI, robots, or 'automatic' in either flavor", () => {
    for (const f of FORBIDDEN) {
      expect(out.subject).not.toContain(f);
      expect(out.text).not.toContain(f);
      expect(out.html).not.toContain(f);
    }
  });
});

describe("buildUnusableDocRetryEmail — English", () => {
  const out = buildUnusableDocRetryEmail({
    ...EMAIL_OPTS,
    clientName: "Sam",
    issueSummary: "the right side of the document is cut off",
    locale: "en",
  });

  it("uses the English subject line", () => {
    expect(out.subject).toBe(
      `Quick fix needed — one document to re-send for ${EMAIL_OPTS.firmName}`,
    );
  });

  it("includes the specific English issue summary verbatim", () => {
    expect(out.text).toContain("the right side of the document is cut off");
  });

  it("never mentions AI, robots, or 'automatic'", () => {
    for (const f of FORBIDDEN) {
      expect(out.subject).not.toContain(f);
      expect(out.text).not.toContain(f);
      expect(out.html).not.toContain(f);
    }
  });
});

describe("buildUnusableDocRetrySms", () => {
  it("French body includes name, item, firm, reason, link", () => {
    const body = buildUnusableDocRetrySms({
      clientName: "Marie",
      firmName: "Cabinet Tremblay",
      requestItemLabel: "T4",
      issueSummary: "texte illisible",
      retryLink: "https://vylan.app/r/abc",
      locale: "fr",
    });
    expect(body).toContain("Marie");
    expect(body).toContain("Cabinet Tremblay");
    expect(body).toContain("T4");
    expect(body).toContain("texte illisible");
    expect(body).toContain("https://vylan.app/r/abc");
  });

  it("English body includes name, item, firm, reason, link", () => {
    const body = buildUnusableDocRetrySms({
      clientName: "Sam",
      firmName: "Tremblay & Co",
      requestItemLabel: "T4",
      issueSummary: "unreadable text",
      retryLink: "https://vylan.app/r/xyz",
      locale: "en",
    });
    expect(body).toContain("Sam");
    expect(body).toContain("Tremblay & Co");
    expect(body).toContain("T4");
    expect(body).toContain("unreadable text");
    expect(body).toContain("https://vylan.app/r/xyz");
  });

  it("never mentions AI, robots, or 'automatic'", () => {
    for (const locale of ["fr", "en"] as const) {
      const body = buildUnusableDocRetrySms({
        clientName: "Marie",
        firmName: "Tremblay",
        requestItemLabel: "T4",
        issueSummary: "x",
        retryLink: "https://example.com",
        locale,
      });
      for (const f of FORBIDDEN) {
        expect(body).not.toContain(f);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Anti-spam helper — drives a minimal supabase mock that returns the
// activity rows we want isAntispamClear to consider.
// ─────────────────────────────────────────────────────────────────────

function mockSupabaseWithRecentSms(rows: { request_item_id: string }[]) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          gte: (_c2: string, _v2: unknown) => ({
            limit: (_n: number) =>
              Promise.resolve({
                data: rows.map((r) => ({
                  id: "x",
                  metadata: { request_item_id: r.request_item_id },
                })),
                error: null,
              }),
          }),
        }),
      }),
    }),
  } as never;
}

describe("isAntispamClear — 30 min SMS window", () => {
  it("clear when no recent SMS for this item", async () => {
    const sb = mockSupabaseWithRecentSms([]);
    expect(await isAntispamClear(sb, "item-1")).toBe(true);
  });

  it("clear when a recent SMS exists for a different item", async () => {
    const sb = mockSupabaseWithRecentSms([{ request_item_id: "other-item" }]);
    expect(await isAntispamClear(sb, "item-1")).toBe(true);
  });

  it("blocked when a recent SMS exists for this same item", async () => {
    const sb = mockSupabaseWithRecentSms([{ request_item_id: "item-1" }]);
    expect(await isAntispamClear(sb, "item-1")).toBe(false);
  });

  it("uses 30 min as the default window", () => {
    expect(SMS_ANTISPAM_WINDOW_MIN).toBe(30);
  });
});
