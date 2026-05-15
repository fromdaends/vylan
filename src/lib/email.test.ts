import { describe, it, expect } from "vitest";
import { buildEngagementInviteEmail } from "./email";

describe("buildEngagementInviteEmail", () => {
  const base = {
    clientName: "Marie Tremblay",
    firmName: "Cabinet Tremblay & Associés",
    engagementTitle: "T1 — Particulier — 2026",
    url: "https://relai.app/r/abcdefg",
    dueDate: "2026-04-30",
  } as const;

  it("emits French subject and body when locale=fr", () => {
    const { subject, html, text } = buildEngagementInviteEmail({
      ...base,
      locale: "fr",
    });
    expect(subject).toMatch(/besoin de quelques documents/);
    expect(html).toContain("Bonjour Marie Tremblay");
    expect(html).toContain("Cabinet Tremblay &amp; Associés");
    expect(text).toContain("Échéance : 2026-04-30");
  });

  it("emits English subject and body when locale=en", () => {
    const { subject, html, text } = buildEngagementInviteEmail({
      ...base,
      locale: "en",
    });
    expect(subject).toMatch(/needs a few documents/);
    expect(html).toContain("Hi Marie Tremblay");
    expect(text).toContain("Due: 2026-04-30");
  });

  it("omits the due-date line when dueDate is null", () => {
    const { html, text } = buildEngagementInviteEmail({
      ...base,
      dueDate: null,
      locale: "en",
    });
    expect(html).not.toContain("Due:");
    expect(text).not.toContain("Due:");
  });

  it("escapes HTML in user-supplied strings", () => {
    const { html } = buildEngagementInviteEmail({
      ...base,
      clientName: "<script>alert(1)</script>",
      locale: "en",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not render a logo block when firmLogoUrl is null or omitted", () => {
    const a = buildEngagementInviteEmail({ ...base, locale: "en" });
    const b = buildEngagementInviteEmail({
      ...base,
      firmLogoUrl: null,
      locale: "en",
    });
    expect(a.html).not.toContain("<img");
    expect(b.html).not.toContain("<img");
  });

  it("renders the firm-logo image at the top with alt text + explicit dimensions when firmLogoUrl is provided", () => {
    const { html } = buildEngagementInviteEmail({
      ...base,
      firmLogoUrl: "https://storage.example/firms/abc/branding/logo-xyz.jpg",
      locale: "en",
    });
    expect(html).toContain(
      `<img src="https://storage.example/firms/abc/branding/logo-xyz.jpg"`,
    );
    expect(html).toContain('alt="Cabinet Tremblay &amp; Associés"');
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
    // Logo must precede the greeting paragraph.
    const imgIdx = html.indexOf("<img");
    const greetingIdx = html.indexOf("Hi Marie Tremblay");
    expect(imgIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeLessThan(greetingIdx);
  });
});
