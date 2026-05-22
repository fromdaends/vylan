import { describe, expect, it, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn(async () => ({ id: "fake" }));

vi.mock("@/lib/email", () => ({
  sendEmail: (args: Parameters<typeof import("@/lib/email").sendEmail>[0]) =>
    sendEmailMock(args),
}));

import {
  notifyFounderNewLead,
  notifyFounderQualifiedLead,
  notifyFounderDemoBooked,
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
    created_at: "2026-05-21T20:00:00Z",
    updated_at: "2026-05-21T20:05:00Z",
    ...extra,
  };
}

describe("notifyFounderNewLead", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("sends an email with subject containing the firm name", async () => {
    await notifyFounderNewLead(fakeRow());
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject).toContain("Acme CPA");
    expect(args.subject.toLowerCase()).toContain("new demo lead");
    expect(args.text).toContain("phil@vylan.app");
    expect(args.text).toContain("Phil Jette");
  });

  it("handles a missing firm_name gracefully", async () => {
    await notifyFounderNewLead(fakeRow({ firm_name: null }));
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject).toContain("unknown firm");
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

  it("subject contains 'Demo booked' and the firm name", async () => {
    await notifyFounderDemoBooked(fakeRow());
    const args = sendEmailMock.mock.calls[0]![0]!;
    expect(args.subject.toLowerCase()).toContain("demo booked");
    expect(args.subject).toContain("Acme CPA");
  });
});
