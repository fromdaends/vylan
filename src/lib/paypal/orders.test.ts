import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("./client", () => ({
  paypalFetch: (path: string, opts?: unknown) => fetchMock(path, opts),
}));

process.env.PAYPAL_CLIENT_ID = "client-1";
process.env.PAYPAL_CLIENT_SECRET = "secret-1";

import { createOrderForInvoice, captureOrder } from "./orders";

beforeEach(() => vi.clearAllMocks());

describe("createOrderForInvoice", () => {
  it("builds a CAPTURE order with the seller as payee, CAD, amount from cents, invoice id on custom_id + invoice_id", async () => {
    fetchMock.mockResolvedValue({ status: 201, json: { id: "ORDER1" } });
    const res = await createOrderForInvoice({
      invoiceId: "inv-1",
      amountCents: 25_000,
      currency: "cad",
      sellerMerchantId: "SELLER1",
      description: "2026 return",
    });
    expect(res).toEqual({ ok: true, orderId: "ORDER1" });

    const [path, opts] = fetchMock.mock.calls[0] as [
      string,
      {
        method: string;
        sellerMerchantId: string;
        body: {
          intent: string;
          purchase_units: {
            custom_id: string;
            invoice_id: string;
            amount: { currency_code: string; value: string };
            payee: { merchant_id: string };
          }[];
        };
      },
    ];
    expect(path).toBe("/v2/checkout/orders");
    expect(opts.method).toBe("POST");
    expect(opts.sellerMerchantId).toBe("SELLER1");
    const pu = opts.body.purchase_units[0];
    expect(opts.body.intent).toBe("CAPTURE");
    expect(pu.custom_id).toBe("inv-1");
    expect(pu.invoice_id).toBe("inv-1");
    expect(pu.amount).toEqual({ currency_code: "CAD", value: "250.00" });
    expect(pu.payee).toEqual({ merchant_id: "SELLER1" });
  });

  it("formats odd cent amounts to two decimals", async () => {
    fetchMock.mockResolvedValue({ status: 201, json: { id: "O" } });
    await createOrderForInvoice({
      invoiceId: "i",
      amountCents: 5,
      currency: "cad",
      sellerMerchantId: "S",
    });
    const opts = fetchMock.mock.calls[0][1] as {
      body: { purchase_units: { amount: { value: string } }[] };
    };
    expect(opts.body.purchase_units[0].amount.value).toBe("0.05");
  });

  it("returns error on a non-created response", async () => {
    fetchMock.mockResolvedValue({
      status: 422,
      json: { name: "UNPROCESSABLE_ENTITY" },
    });
    const res = await createOrderForInvoice({
      invoiceId: "i",
      amountCents: 100,
      currency: "cad",
      sellerMerchantId: "S",
    });
    expect(res).toEqual({
      ok: false,
      reason: "error",
      detail: "UNPROCESSABLE_ENTITY",
    });
  });
});

describe("captureOrder", () => {
  it("COMPLETED: returns the capture id + echoed invoice id (custom_id)", async () => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: {
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: "inv-1",
            payments: { captures: [{ id: "CAP1", status: "COMPLETED" }] },
          },
        ],
      },
    });
    const res = await captureOrder({ orderId: "ORDER1", sellerMerchantId: "S" });
    expect(res).toEqual({
      ok: true,
      status: "COMPLETED",
      captureId: "CAP1",
      customId: "inv-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v2/checkout/orders/ORDER1/capture",
      expect.objectContaining({ method: "POST", sellerMerchantId: "S" }),
    );
  });

  it("ORDER_ALREADY_CAPTURED maps to already_captured (benign, invoice is paid)", async () => {
    fetchMock.mockResolvedValue({
      status: 422,
      json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] },
    });
    const res = await captureOrder({ orderId: "ORDER1", sellerMerchantId: "S" });
    expect(res).toEqual({
      ok: false,
      reason: "already_captured",
      detail: "ORDER_ALREADY_CAPTURED",
    });
  });

  it("a declined instrument maps to declined", async () => {
    fetchMock.mockResolvedValue({
      status: 422,
      json: { details: [{ issue: "INSTRUMENT_DECLINED" }] },
    });
    const res = await captureOrder({ orderId: "O", sellerMerchantId: "S" });
    expect(res).toEqual({
      ok: false,
      reason: "declined",
      detail: "INSTRUMENT_DECLINED",
    });
  });

  it("PENDING status is returned as ok (not COMPLETED) so the caller leaves the invoice open", async () => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: {
        status: "PENDING",
        purchase_units: [
          {
            custom_id: "inv-1",
            payments: { captures: [{ id: "CAP1", status: "PENDING" }] },
          },
        ],
      },
    });
    const res = await captureOrder({ orderId: "O", sellerMerchantId: "S" });
    expect(res).toEqual({
      ok: true,
      status: "PENDING",
      captureId: "CAP1",
      customId: "inv-1",
    });
  });
});
