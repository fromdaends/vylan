import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("./client", () => ({
  paypalFetch: (path: string, opts?: unknown) => fetchMock(path, opts),
}));

process.env.PAYPAL_CLIENT_ID = "client-1";
process.env.PAYPAL_CLIENT_SECRET = "secret-1";
process.env.PAYPAL_PARTNER_MERCHANT_ID = "PARTNER99";

import {
  createPartnerReferral,
  getSellerIntegrationStatus,
  findSellerMerchantIdByTrackingId,
} from "./onboarding";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYPAL_PARTNER_MERCHANT_ID = "PARTNER99";
});

describe("createPartnerReferral", () => {
  it("201: returns the hosted action_url, with the firm id as tracking_id", async () => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: {
        links: [
          { rel: "self", href: "https://api.sandbox.paypal.com/ref/1" },
          { rel: "action_url", href: "https://www.sandbox.paypal.com/go" },
        ],
      },
    });
    const res = await createPartnerReferral("firm-1", "https://app/callback");
    expect(res).toEqual({
      ok: true,
      actionUrl: "https://www.sandbox.paypal.com/go",
    });
    const [path, opts] = fetchMock.mock.calls[0] as [
      string,
      { body: { tracking_id: string; partner_config_override: { return_url: string } } },
    ];
    expect(path).toBe("/v2/customer/partner-referrals");
    expect(opts.body.tracking_id).toBe("firm-1");
    expect(opts.body.partner_config_override.return_url).toBe(
      "https://app/callback",
    );
  });

  it("403 / NOT_AUTHORIZED: the pending-partner-approval case, surfaced distinctly", async () => {
    fetchMock.mockResolvedValue({
      status: 403,
      json: { name: "NOT_AUTHORIZED", message: "no" },
    });
    const res = await createPartnerReferral("firm-1", "https://app/cb");
    expect(res).toEqual({
      ok: false,
      reason: "not_authorized",
      detail: "NOT_AUTHORIZED",
    });
  });

  it("201 without an action_url is an error, not a success", async () => {
    fetchMock.mockResolvedValue({ status: 201, json: { links: [] } });
    const res = await createPartnerReferral("firm-1", "https://app/cb");
    expect(res).toEqual({ ok: false, reason: "error", detail: "no_action_url" });
  });
});

describe("getSellerIntegrationStatus", () => {
  it("parses PayPal's authoritative flags + the third-party grant", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: {
        merchant_id: "SELLER1",
        payments_receivable: true,
        primary_email_confirmed: false,
        oauth_integrations: [{ integration_type: "OAUTH_THIRD_PARTY" }],
      },
    });
    const res = await getSellerIntegrationStatus("SELLER1");
    expect(res).toEqual({
      ok: true,
      status: {
        merchantId: "SELLER1",
        paymentsReceivable: true,
        primaryEmailConfirmed: false,
        permissionsGranted: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/customer/partners/PARTNER99/merchant-integrations/SELLER1",
      undefined,
    );
  });

  it("404 = seller not under our partner account", async () => {
    fetchMock.mockResolvedValue({ status: 404, json: { name: "NOT_FOUND" } });
    expect(await getSellerIntegrationStatus("NOPE")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("without PAYPAL_PARTNER_MERCHANT_ID: fails closed with no_partner_id", async () => {
    process.env.PAYPAL_PARTNER_MERCHANT_ID = "";
    expect(await getSellerIntegrationStatus("SELLER1")).toEqual({
      ok: false,
      reason: "no_partner_id",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("findSellerMerchantIdByTrackingId", () => {
  it("reads merchant_id directly when present", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: { merchant_id: "SELLER7" },
    });
    expect(await findSellerMerchantIdByTrackingId("firm-1")).toBe("SELLER7");
  });

  it("falls back to parsing the self link", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: {
        links: [
          {
            rel: "self",
            href: "https://api/v1/customer/partners/PARTNER99/merchant-integrations/SELLER8",
          },
        ],
      },
    });
    expect(await findSellerMerchantIdByTrackingId("firm-1")).toBe("SELLER8");
  });

  it("null on 404 (nothing onboarded under this tracking id)", async () => {
    fetchMock.mockResolvedValue({ status: 404, json: null });
    expect(await findSellerMerchantIdByTrackingId("firm-1")).toBeNull();
  });
});
