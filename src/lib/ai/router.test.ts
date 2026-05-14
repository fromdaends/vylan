import { describe, it, expect } from "vitest";
import { decide, AUTO_REJECT_STRIKE_LIMIT } from "./router";

describe("decide — rejection routing", () => {
  it("queues for accountant when auto-reject is off (regardless of count)", () => {
    expect(decide({ autoRejectOn: false, rejectionCount: 0 })).toBe(
      "queue_for_accountant",
    );
    expect(decide({ autoRejectOn: false, rejectionCount: 5 })).toBe(
      "queue_for_accountant",
    );
  });

  it("auto-rejects on the first strike", () => {
    expect(decide({ autoRejectOn: true, rejectionCount: 0 })).toBe(
      "auto_reject_and_notify_client",
    );
  });

  it("auto-rejects on the second strike (still below the limit)", () => {
    expect(decide({ autoRejectOn: true, rejectionCount: 1 })).toBe(
      "auto_reject_and_notify_client",
    );
  });

  it("escalates when strike count meets the limit", () => {
    expect(
      decide({ autoRejectOn: true, rejectionCount: AUTO_REJECT_STRIKE_LIMIT }),
    ).toBe("escalate_to_accountant");
  });

  it("escalates when strike count exceeds the limit", () => {
    expect(
      decide({
        autoRejectOn: true,
        rejectionCount: AUTO_REJECT_STRIKE_LIMIT + 5,
      }),
    ).toBe("escalate_to_accountant");
  });
});
