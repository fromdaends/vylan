import { describe, expect, it, vi, beforeEach } from "vitest";

// Type the mock so `mock.calls[i]![0]` has known fields — without
// this, vi.fn() with a no-arg implementation gives back a `never`
// tuple and tests can't safely read .subject / .text on the call.
type SendEmailArgs = Parameters<typeof import("@/lib/email").sendEmail>[0];
const sendEmailMock = vi.fn(
  async (_args: SendEmailArgs) => ({ sent: true as const, id: "fake" }),
);

vi.mock("@/lib/email", () => ({
  sendEmail: (args: Parameters<typeof import("@/lib/email").sendEmail>[0]) =>
    sendEmailMock(args),
}));

import {
  notifyFounderLead,
  notifyFounderPartialLead,
  notifyFounderQualifiedLead,
  notifyFounderDemoBooked,
  notifyFounderNewSignup,
} from "./demo-notify";
import type { DemoRequest } from "./db/demo-requests";

function fakeRow(extra: Partial<DemoRequest> = {}): DemoRequest {
  return {
    id: "row-123",
    contact_name: "Phil Jette",
    email: "phil@vylan.app",
    firm_name: "Acme CPA",
    firm_size: "2_5",
    client_volume: "25_100",
    current_tool: "taxdome",
    current_tool_other: null,
    phone: "+1 514 555 0100",
    province: "QC",
    preferred_language: "fr",
    marketing_opt_in: true,
    furthest_step: 3,
    booked_at: null,
    notified_at: null,
    notion_page_id: null,
    practice_type: null,
    active_clients: null,
    notes: null,
    source: null,
    created_at: "2026-05-21T20:00:00Z",
    updated_at: "2026-05-21T20:05:00Z",
    ...extra,
  };
}

describe("notifyFounderPartialLead", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("sends with a 'Partial demo lead' subject for a step-1-only row", async () => {
    await notifyFounderPartialLead(
      fakeRow({
        furthest_step: 1,
        firm_size: null,
        client_volume: null,
        current_tool: null,
        phone: null,
        province: null,
        preferred_language: null,
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject.toLowerCase()).toContain("partial demo lead");
    expect(args.subject).toContain("Acme CPA");
    expect(args.text).toContain("phil@vylan.app");
    expect(args.text).toContain("step 1 of 3");
  });

  it("includes step-2 qualifying labels when present", async () => {
    await notifyFounderPartialLead(fakeRow({ furthest_step: 2 }));
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.text).toContain("2-5 people");
    expect(args.text).toContain("25-100 clients");
    expect(args.text).toContain("TaxDome");
  });

  it("handles a missing firm_name gracefully", async () => {
    await notifyFounderPartialLead(
      fakeRow({ furthest_step: 1, firm_name: null }),
    );
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject).toContain("unknown firm");
  });
});

describe("notifyFounderLead routing", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("routes furthest_step=3 rows to the qualified-lead email", async () => {
    await notifyFounderLead(fakeRow({ furthest_step: 3 }));
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject.toLowerCase()).toContain("qualified demo lead");
  });

  it("routes furthest_step<3 rows to the partial-lead email", async () => {
    await notifyFounderLead(fakeRow({ furthest_step: 2 }));
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject.toLowerCase()).toContain("partial demo lead");
  });
});

describe("notifyFounderQualifiedLead", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("includes the qualifying data + a 'qualified' subject", async () => {
    await notifyFounderQualifiedLead(fakeRow());
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject.toLowerCase()).toContain("qualified demo lead");
    expect(args.subject).toContain("Acme CPA");
    // Body should contain humanised labels for the qualifying fields.
    expect(args.text).toContain("2-5 people");
    expect(args.text).toContain("25-100 clients");
    expect(args.text).toContain("TaxDome");
    expect(args.text).toContain("Marketing opt-in: YES");
  });

  it("formats current_tool=other_software with the free-text follow-up", async () => {
    await notifyFounderQualifiedLead(
      fakeRow({
        current_tool: "other_software",
        current_tool_other: "Citrix ShareFile",
      }),
    );
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.text).toContain("Other software — Citrix ShareFile");
  });

  it("marks marketing opt-in NO when false (CASL — must never default on)", async () => {
    await notifyFounderQualifiedLead(fakeRow({ marketing_opt_in: false }));
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.text).toContain("Marketing opt-in: no");
  });
});

describe("notifyFounderDemoBooked", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("subject calls out the booking + the firm name + size", async () => {
    await notifyFounderDemoBooked(fakeRow());
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject.toLowerCase()).toContain("demo booked");
    expect(args.subject).toContain("Acme CPA");
    expect(args.subject).toContain("2-5 people");
  });

  it("body is the full call-prep sheet (it's the only email for fast-booking leads)", async () => {
    await notifyFounderDemoBooked(fakeRow());
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.text).toContain("2-5 people");
    expect(args.text).toContain("25-100 clients");
    expect(args.text).toContain("TaxDome");
    expect(args.text).toContain("Marketing opt-in: YES");
  });
});

describe("notifyFounderNewSignup", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("emails the founder the firm ID + owner login email (Stripe copy-paste)", async () => {
    await notifyFounderNewSignup({
      firmId: "a1b2c3d4-5e6f-7890-abcd-ef1234567890",
      firmName: "Cabinet Lavoie",
      ownerName: "Marie Lavoie",
      ownerEmail: "marie@cabinetlavoie.ca",
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject).toContain("Cabinet Lavoie");
    // The login email + firm ID must appear in BOTH bodies — they're exactly
    // what the founder pastes into Stripe to bill + activate the prospect.
    for (const body of [args.text, args.html]) {
      expect(body).toContain("marie@cabinetlavoie.ca");
      expect(body).toContain("a1b2c3d4-5e6f-7890-abcd-ef1234567890");
    }
  });

  it("is best-effort: never throws if Resend fails", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("resend down"));
    await expect(
      notifyFounderNewSignup({
        firmId: "f",
        firmName: "F",
        ownerName: "O",
        ownerEmail: "o@example.com",
      }),
    ).resolves.toBeUndefined();
  });
});
