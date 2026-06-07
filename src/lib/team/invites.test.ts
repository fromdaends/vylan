import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiryISO,
  inviteAcceptUrl,
  parseInviteEmail,
  inviteState,
  INVITE_TTL_DAYS,
} from "./invites";
import { buildTeamInviteEmail } from "@/lib/email";

describe("generateInviteToken", () => {
  it("is URL-safe (base64url) and long", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // no +, /, or = padding
    expect(t.length).toBeGreaterThanOrEqual(40);
  });
  it("is unique across calls", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });
});

describe("hashInviteToken", () => {
  it("is a deterministic 64-char hex digest", () => {
    const h = hashInviteToken("the-raw-token");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken("the-raw-token")).toBe(h);
  });
  it("differs for different tokens (and never equals the raw token)", () => {
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
    const raw = generateInviteToken();
    expect(hashInviteToken(raw)).not.toBe(raw);
  });
});

describe("inviteExpiryISO", () => {
  it("is INVITE_TTL_DAYS (7) after the given time", () => {
    const from = Date.parse("2026-01-01T00:00:00.000Z");
    expect(inviteExpiryISO(from)).toBe("2026-01-08T00:00:00.000Z");
    expect(INVITE_TTL_DAYS).toBe(7);
  });
});

describe("inviteAcceptUrl", () => {
  it("builds {appUrl}/{locale}/invite/{token}", () => {
    expect(inviteAcceptUrl("https://app.vylan.app", "fr", "TOK")).toBe(
      "https://app.vylan.app/fr/invite/TOK",
    );
  });
  it("strips a trailing slash on appUrl", () => {
    expect(inviteAcceptUrl("https://app.vylan.app/", "en", "TOK")).toBe(
      "https://app.vylan.app/en/invite/TOK",
    );
  });
});

describe("parseInviteEmail", () => {
  it("accepts + normalizes (trim, lowercase) a valid email", () => {
    expect(parseInviteEmail("  Bob@Example.COM ")).toEqual({
      ok: true,
      email: "bob@example.com",
    });
  });
  it("rejects garbage / empty / non-string", () => {
    expect(parseInviteEmail("not-an-email").ok).toBe(false);
    expect(parseInviteEmail("").ok).toBe(false);
    expect(parseInviteEmail(null).ok).toBe(false);
    expect(parseInviteEmail(42).ok).toBe(false);
  });
});

describe("inviteState", () => {
  const future = "2999-01-01T00:00:00.000Z";
  const past = "2000-01-01T00:00:00.000Z";
  const now = Date.parse("2026-06-01T00:00:00.000Z");

  it("is pending when live, unaccepted, unrevoked", () => {
    expect(
      inviteState(
        { accepted_at: null, revoked_at: null, expires_at: future },
        now,
      ),
    ).toBe("pending");
  });
  it("is expired once past expires_at", () => {
    expect(
      inviteState(
        { accepted_at: null, revoked_at: null, expires_at: past },
        now,
      ),
    ).toBe("expired");
  });
  it("is accepted when accepted_at is set", () => {
    expect(
      inviteState(
        { accepted_at: past, revoked_at: null, expires_at: future },
        now,
      ),
    ).toBe("accepted");
  });
  it("revoked wins over everything", () => {
    expect(
      inviteState(
        { accepted_at: past, revoked_at: past, expires_at: future },
        now,
      ),
    ).toBe("revoked");
  });
});

describe("buildTeamInviteEmail", () => {
  const base = {
    firmName: "Cabinet Tremblay",
    inviterName: "Marie",
    acceptUrl: "https://app.vylan.app/fr/invite/TOK123",
    locale: "fr" as const,
  };

  it("FR: subject + body carry the firm, inviter, link and Vylan brand", () => {
    const { subject, html, text } = buildTeamInviteEmail(base);
    expect(subject).toContain("Cabinet Tremblay");
    expect(subject).toContain("Vylan");
    expect(html).toContain("Marie");
    expect(html).toContain(base.acceptUrl);
    expect(html).toContain("7 jours");
    expect(text).toContain(base.acceptUrl);
  });

  it("EN: switches language", () => {
    const { subject, html } = buildTeamInviteEmail({ ...base, locale: "en" });
    expect(subject).toContain("invited to join");
    expect(html).toContain("Create my account");
    expect(html).toContain("7 days");
  });

  it("never says the legacy brand name, and uses no em dashes", () => {
    for (const locale of ["fr", "en"] as const) {
      const { subject, html, text } = buildTeamInviteEmail({ ...base, locale });
      expect(`${subject} ${html} ${text}`).not.toMatch(/relai/i);
      expect(`${subject} ${html} ${text}`).not.toContain("—"); // em dash
    }
  });

  it("HTML-escapes the firm + inviter names", () => {
    const { html } = buildTeamInviteEmail({
      ...base,
      firmName: "A & B <script>",
      inviterName: "O'Brien",
    });
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("O&#39;Brien");
  });
});
