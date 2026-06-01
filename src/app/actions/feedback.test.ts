import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
const sendEmailMock = vi.fn(async (args: unknown) => {
  void args;
  return { sent: true, id: "x" };
});

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}));
vi.mock("@/lib/db/firms", () => ({
  getCurrentFirm: async () => ({ id: "firm-1", name: "Cabinet Test" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  FEEDBACK_PER_USER: { limit: 5, window: "1 h" },
}));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (k: string) => (k === "user-agent" ? "TestUA/1.0" : null),
  }),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: (args: unknown) => sendEmailMock(args),
  escapeHtml: (s: string) => s,
}));

import { submitFeedbackAction } from "./feedback";

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

describe("submitFeedbackAction — emails the team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Force the default recipient (no override env).
    delete process.env.FOUNDER_NOTIFY_EMAIL;
    getUserMock.mockResolvedValue({
      data: { user: { id: "u1", email: "owner@firm.test" } },
    });
    insertMock.mockResolvedValue({ error: null });
  });

  it("sends the feedback to hello@vylan.app after saving it", async () => {
    const res = await submitFeedbackAction(
      null,
      fd({ message: "Love the app!", page_url: "/dashboard" }),
    );
    expect(res).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = sendEmailMock.mock.calls[0][0] as {
      to: string;
      from?: string;
      replyTo?: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(arg.to).toBe("hello@vylan.app");
    // Sent from a distinct address (not hello@→hello@) to dodge spam-filing.
    expect(arg.from).toContain("notifications@vylan.app");
    expect(arg.replyTo).toBe("owner@firm.test");
    expect(arg.subject).toContain("Cabinet Test");
    expect(arg.html).toContain("Love the app!");
    expect(arg.text).toContain("/dashboard");
  });

  it("honours FOUNDER_NOTIFY_EMAIL when set", async () => {
    process.env.FOUNDER_NOTIFY_EMAIL = "founder@vylan.app";
    await submitFeedbackAction(null, fd({ message: "Hello there" }));
    const arg = sendEmailMock.mock.calls[0][0] as { to: string };
    expect(arg.to).toBe("founder@vylan.app");
  });

  it("still saves and returns ok even if the email send throws", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("resend down"));
    const res = await submitFeedbackAction(
      null,
      fd({ message: "Still works", page_url: "/x" }),
    );
    expect(res).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("does not email when validation fails", async () => {
    const res = await submitFeedbackAction(null, fd({ message: "no" }));
    expect(res).toEqual({ ok: false, error: "min_3_chars" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not email when the user isn't signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await submitFeedbackAction(
      null,
      fd({ message: "Hi from nowhere" }),
    );
    expect(res).toEqual({ ok: false, error: "unauthorized" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
