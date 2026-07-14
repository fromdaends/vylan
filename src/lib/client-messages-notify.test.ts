import { describe, it, expect } from "vitest";
import {
  buildSnippet,
  clientNotifyDecision,
  firmNotifyDecision,
  SNIPPET_MAX_LENGTH,
} from "./client-messages-notify";
import { buildClientMessageEmail, buildFirmMessageEmail } from "./email";

const msg = (
  sender: "firm" | "client",
  created_at: string,
  body = "hello",
) => ({ sender, created_at, body });

describe("clientNotifyDecision", () => {
  it("skips when the firm never wrote", () => {
    expect(
      clientNotifyDecision({
        messages: [msg("client", "2026-07-01T10:00:00Z")],
        clientLastReadAt: null,
        clientLastNotifiedAt: null,
      }),
    ).toEqual({ send: false, reason: "no_firm_messages" });
  });

  it("skips when the client already read past the newest firm message", () => {
    expect(
      clientNotifyDecision({
        messages: [msg("firm", "2026-07-01T10:00:00Z")],
        clientLastReadAt: "2026-07-01T11:00:00Z",
        clientLastNotifiedAt: null,
      }),
    ).toEqual({ send: false, reason: "already_read" });
  });

  it("skips when the client was already emailed about the newest message (rerun idempotency)", () => {
    expect(
      clientNotifyDecision({
        messages: [msg("firm", "2026-07-01T10:00:00Z")],
        clientLastReadAt: null,
        clientLastNotifiedAt: "2026-07-01T10:00:00Z",
      }),
    ).toEqual({ send: false, reason: "already_notified" });
  });

  it("sends ONE email covering a whole burst, counting only messages past read+notified", () => {
    const d = clientNotifyDecision({
      messages: [
        msg("firm", "2026-07-01T08:00:00Z", "old, already notified"),
        msg("client", "2026-07-01T09:00:00Z"),
        msg("firm", "2026-07-01T10:00:00Z", "first of burst"),
        msg("firm", "2026-07-01T10:01:00Z", "second of burst"),
        msg("firm", "2026-07-01T10:02:00Z", "the latest"),
      ],
      clientLastReadAt: "2026-07-01T08:30:00Z",
      clientLastNotifiedAt: "2026-07-01T08:00:00Z",
    });
    expect(d.send).toBe(true);
    if (d.send) {
      expect(d.count).toBe(3);
      expect(d.latest.body).toBe("the latest");
    }
  });
});

describe("firmNotifyDecision", () => {
  it("skips when the client never wrote, or the firm already read", () => {
    expect(
      firmNotifyDecision({
        messages: [msg("firm", "2026-07-01T10:00:00Z")],
        firmLastReadAt: null,
      }),
    ).toEqual({ send: false, reason: "no_client_messages" });
    expect(
      firmNotifyDecision({
        messages: [msg("client", "2026-07-01T10:00:00Z")],
        firmLastReadAt: "2026-07-01T10:00:00Z",
      }),
    ).toEqual({ send: false, reason: "already_read" });
  });

  it("counts unseen client replies and surfaces the latest", () => {
    const d = firmNotifyDecision({
      messages: [
        msg("client", "2026-07-01T09:00:00Z", "seen already"),
        msg("firm", "2026-07-01T09:30:00Z"),
        msg("client", "2026-07-01T10:00:00Z", "reply one"),
        msg("client", "2026-07-01T10:05:00Z", "reply two"),
      ],
      firmLastReadAt: "2026-07-01T09:15:00Z",
    });
    expect(d.send).toBe(true);
    if (d.send) {
      expect(d.count).toBe(2);
      expect(d.latest.body).toBe("reply two");
    }
  });
});

describe("buildSnippet", () => {
  it("passes short bodies through and truncates long ones with an ellipsis", () => {
    expect(buildSnippet("  short  ")).toBe("short");
    const long = "x".repeat(500);
    const snippet = buildSnippet(long);
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_LENGTH);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("message notification email builders", () => {
  it("client email carries the snippet, sender, deep link, and localizes", () => {
    const en = buildClientMessageEmail({
      clientName: "Marie",
      firmName: "Cabinet T",
      senderName: "Zach",
      engagementTitle: "T1 2026",
      snippet: "Your T4 <looks> good",
      count: 1,
      url: "https://vylan.app/r/tok?view=messages",
      locale: "en",
    });
    expect(en.subject).toBe("New message from Cabinet T");
    expect(en.html).toContain("Your T4 &lt;looks&gt; good");
    expect(en.html).toContain("https://vylan.app/r/tok?view=messages");
    expect(en.text).toContain("Zach sent you a message");

    const fr = buildClientMessageEmail({
      clientName: "Marie",
      firmName: "Cabinet T",
      senderName: "Zach",
      engagementTitle: "T1 2026",
      snippet: "Bonjour",
      count: 3,
      url: "https://vylan.app/r/tok?view=messages",
      locale: "fr",
    });
    expect(fr.subject).toBe("3 nouveaux messages de Cabinet T");
    expect(fr.html).toContain("Ouvrir la conversation");
  });

  it("firm email names the client, counts the burst, and links the engagement", () => {
    const out = buildFirmMessageEmail({
      accountantName: "Zach",
      clientName: "Marie Tremblay",
      engagementTitle: "T1 2026",
      snippet: "One question",
      count: 2,
      url: "https://vylan.app/en/engagements/e1",
      locale: "en",
    });
    expect(out.subject).toBe(
      "Marie Tremblay sent you 2 messages — T1 2026",
    );
    expect(out.html).toContain("One question");
    expect(out.html).toContain("https://vylan.app/en/engagements/e1");
    expect(out.text).toContain("Open the engagement");
  });
});
