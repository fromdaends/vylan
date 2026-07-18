import { describe, it, expect } from "vitest";
import {
  personalSignOff,
  buildEngagementInviteEmail,
  buildConfirmEmail,
  buildSignedCopyReturnedEmail,
  buildReminderEmail,
  resolveSender,
} from "./email";

describe("buildEngagementInviteEmail", () => {
  const base = {
    clientName: "Marie Tremblay",
    firmName: "Cabinet Tremblay & Associés",
    engagementTitle: "T1 — Particulier — 2026",
    url: "https://vylan.app/r/abcdefg",
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

describe("resolveSender", () => {
  it("gives the default sender a 'Vylan' display name", () => {
    expect(resolveSender(undefined)).toBe("Vylan <hello@vylan.app>");
    expect(resolveSender(null)).toBe("Vylan <hello@vylan.app>");
    expect(resolveSender("")).toBe("Vylan <hello@vylan.app>");
  });
  it("wraps a bare custom address with the Vylan name", () => {
    expect(resolveSender("notifications@vylan.app")).toBe(
      "Vylan <notifications@vylan.app>",
    );
  });
  it("keeps a display name the caller already provided", () => {
    expect(resolveSender("Vylan <notifications@vylan.app>")).toBe(
      "Vylan <notifications@vylan.app>",
    );
  });
  it("ignores a leftover resend.dev sandbox address", () => {
    expect(resolveSender("onboarding@resend.dev")).toBe(
      "Vylan <hello@vylan.app>",
    );
  });
});

describe("buildReminderEmail customization", () => {
  const base = {
    tone: "gentle" as const,
    clientName: "Zach",
    firmName: "North Star Accounting",
    engagementTitle: "T1 — 2026",
    url: "https://vylan.app/r/test",
    dueDate: "2026-04-30",
    pendingRequiredCount: 3,
    locale: "en" as const,
  };

  it("interpolates tokens in custom subjects and messages", () => {
    const email = buildReminderEmail({
      ...base,
      customSubject: "{client}: {pending} items for {engagement}",
      customMessage: "Hi {client},\n\nPlease upload the files for {firm}.",
    });
    expect(email.subject).toBe("Zach: 3 items for T1 — 2026");
    expect(email.text).toContain("Please upload the files for North Star Accounting.");
    expect(email.html).toContain("Please upload the files for North Star Accounting.");
  });

  it("escapes HTML in a custom message", () => {
    const email = buildReminderEmail({
      ...base,
      customMessage: "Upload <script>alert(1)</script>",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("buildConfirmEmail", () => {
  const confirmUrl =
    "https://vylan.app/api/auth/confirm?token_hash=abc123&type=signup&next=%2Fen%2Fonboarding";

  it("embeds the confirm link in both the button and the copy-paste fallback (en)", () => {
    const { subject, html, text } = buildConfirmEmail({
      ownerName: "Phil",
      confirmUrl,
      locale: "en",
    });
    expect(subject).toMatch(/confirm/i);
    // Link present in the HTML href and in the plain-text body.
    expect(html).toContain(`href="${confirmUrl}"`);
    expect(html).toContain(confirmUrl); // copy-paste fallback too
    expect(text).toContain(confirmUrl);
    expect(html).toContain("Phil");
  });

  it("emits French copy when locale=fr", () => {
    const { subject, html } = buildConfirmEmail({
      ownerName: "Marie",
      confirmUrl,
      locale: "fr",
    });
    expect(subject).toMatch(/confirmez/i);
    expect(html).toContain("Confirmer mon courriel");
    expect(html).toContain(`href="${confirmUrl}"`);
  });

  it("escapes the owner name to avoid HTML injection", () => {
    const { html } = buildConfirmEmail({
      ownerName: "<script>x</script>",
      confirmUrl,
      locale: "en",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildSignedCopyReturnedEmail", () => {
  const base = {
    accountantName: "Marie",
    clientName: "Jean Tremblay",
    documentName: "Lettre de mission",
    engagementTitle: "Déclaration T1 2025",
    reviewUrl: "https://vylan.app/fr/engagements/eng-123",
    locale: "fr" as const,
  };

  it("names the client + document and embeds the review link (fr)", () => {
    const { subject, html, text } = buildSignedCopyReturnedEmail(base);
    expect(subject).toContain("Jean Tremblay");
    expect(html).toContain("Bonjour Marie,");
    expect(html).toContain("Lettre de mission");
    expect(html).toContain("Déclaration T1 2025");
    expect(html).toContain(`href="${base.reviewUrl}"`);
    expect(html).toContain(base.reviewUrl); // copy-paste fallback
    expect(text).toContain(base.reviewUrl);
  });

  it("emits English copy when locale=en", () => {
    const { subject, html } = buildSignedCopyReturnedEmail({
      ...base,
      locale: "en",
    });
    expect(subject).toContain("Signed copy returned");
    expect(html).toContain("Hi Marie,");
    expect(html).toContain("Review in Vylan");
  });

  it("falls back to a nameless greeting when the accountant has no name", () => {
    const fr = buildSignedCopyReturnedEmail({ ...base, accountantName: null });
    expect(fr.html).toContain("<p>Bonjour,</p>");
    const en = buildSignedCopyReturnedEmail({
      ...base,
      accountantName: null,
      locale: "en",
    });
    expect(en.html).toContain("<p>Hi,</p>");
  });

  it("escapes client/document/title to avoid HTML injection", () => {
    const { html } = buildSignedCopyReturnedEmail({
      ...base,
      clientName: "<script>x</script>",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("makes NO legal / e-signature-validity claim", () => {
    const fr = buildSignedCopyReturnedEmail(base);
    const en = buildSignedCopyReturnedEmail({ ...base, locale: "en" });
    for (const out of [fr, en]) {
      const blob = `${out.subject}\n${out.html}\n${out.text}`.toLowerCase();
      expect(blob).not.toContain("legally binding");
      expect(blob).not.toContain("certified");
      expect(blob).not.toContain("juridiquement");
      expect(blob).not.toContain("certifié");
    }
  });
});

describe("personalSignOff", () => {
  it("puts the accountant's name in front of the firm when present", () => {
    expect(personalSignOff("Marie Tremblay", "Cabinet Tremblay")).toBe(
      "Marie Tremblay, Cabinet Tremblay",
    );
  });

  it("falls back to the firm alone when there's no accountant", () => {
    expect(personalSignOff(null, "Cabinet Tremblay")).toBe("Cabinet Tremblay");
    expect(personalSignOff(undefined, "Cabinet Tremblay")).toBe("Cabinet Tremblay");
    expect(personalSignOff("   ", "Cabinet Tremblay")).toBe("Cabinet Tremblay");
  });

  it("trims the accountant name", () => {
    expect(personalSignOff("  Marie  ", "Firm")).toBe("Marie, Firm");
  });
});

describe("buildReminderEmail personal sign-off", () => {
  const base = {
    tone: "gentle" as const,
    clientName: "Client",
    firmName: "Cabinet Tremblay",
    engagementTitle: "2025 T1",
    url: "https://vylan.app/r/tok",
    dueDate: null,
    pendingRequiredCount: 2,
    locale: "en" as const,
  };

  it("signs off with the accountant when provided", () => {
    const { html, text } = buildReminderEmail({ ...base, accountantName: "Marie" });
    expect(html).toContain("— Marie, Cabinet Tremblay");
    expect(text).toContain("— Marie, Cabinet Tremblay");
  });

  it("signs off with the firm alone otherwise", () => {
    const { html, text } = buildReminderEmail(base);
    expect(html).toContain("— Cabinet Tremblay");
    expect(text).toContain("— Cabinet Tremblay");
  });
});
