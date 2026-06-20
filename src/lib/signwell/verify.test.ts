import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { isValidSignwellEventHash } from "./verify";

const WEBHOOK_ID = "wh_test_123";

function sign(type: string, time: string | number, key = WEBHOOK_ID): string {
  return createHmac("sha256", key).update(`${type}@${time}`).digest("hex");
}

describe("isValidSignwellEventHash", () => {
  it("accepts a correctly signed event", () => {
    const type = "document_completed";
    const time = 1718856000;
    const hash = sign(type, time);
    expect(
      isValidSignwellEventHash({ type, time, hash, webhookId: WEBHOOK_ID }),
    ).toBe(true);
  });

  it("rejects a tampered hash", () => {
    expect(
      isValidSignwellEventHash({
        type: "document_completed",
        time: 1718856000,
        hash: sign("document_completed", 1718856000).replace(/.$/, "0"),
        webhookId: WEBHOOK_ID,
      }),
    ).toBe(false);
  });

  it("rejects when the webhook id (key) is wrong", () => {
    const hash = sign("document_completed", 1718856000, "other-key");
    expect(
      isValidSignwellEventHash({
        type: "document_completed",
        time: 1718856000,
        hash,
        webhookId: WEBHOOK_ID,
      }),
    ).toBe(false);
  });

  it("rejects a changed type or time (the signed payload)", () => {
    const hash = sign("document_completed", 1718856000);
    expect(
      isValidSignwellEventHash({
        type: "document_viewed",
        time: 1718856000,
        hash,
        webhookId: WEBHOOK_ID,
      }),
    ).toBe(false);
    expect(
      isValidSignwellEventHash({
        type: "document_completed",
        time: 1718856001,
        hash,
        webhookId: WEBHOOK_ID,
      }),
    ).toBe(false);
  });

  it("rejects missing key, hash, or type", () => {
    const hash = sign("document_completed", 1718856000);
    expect(
      isValidSignwellEventHash({
        type: "document_completed",
        time: 1718856000,
        hash,
        webhookId: "",
      }),
    ).toBe(false);
    expect(
      isValidSignwellEventHash({
        type: "document_completed",
        time: 1718856000,
        hash: "",
        webhookId: WEBHOOK_ID,
      }),
    ).toBe(false);
  });
});
