import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { PaymentCanceledChip } from "./payment-canceled-chip";
import { PAYMENT_CANCELED_CHIP_WINDOW_MS } from "@/lib/payments/canceled-chip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaymentCanceledChip", () => {
  // Regression guard. The window constant must NOT live in / be re-exported from
  // this "use client" module: the server page imports it to decide whether to
  // render the chip, and a value exported from a client module reaches a Server
  // Component as a stub function, not a number — making the "is this cancel
  // recent?" comparison silently false forever, so the chip never appeared.
  // That bug shipped once; this keeps the constant in the neutral lib module.
  it("does not export the window constant (server reads it from lib/payments)", async () => {
    const mod = await import("./payment-canceled-chip");
    expect("PAYMENT_CANCELED_CHIP_WINDOW_MS" in mod).toBe(false);
    expect(typeof PAYMENT_CANCELED_CHIP_WINDOW_MS).toBe("number");
  });

  it("shows during the window, then removes itself after it", () => {
    vi.useFakeTimers();
    const now = new Date();
    vi.setSystemTime(now);

    render(
      <PaymentCanceledChip
        canceledAt={now.toISOString()}
        label="Payment canceled"
        amountLabel="$1,000.00"
        windowMs={1000}
      />,
    );
    // Visible right after the cancel.
    expect(screen.getByText(/Payment canceled/)).toBeInTheDocument();

    // Past the window + the short fade buffer → gone from the DOM.
    act(() => {
      vi.advanceTimersByTime(1000 + 400 + 10);
    });
    expect(screen.queryByText(/Payment canceled/)).not.toBeInTheDocument();
  });

  it("hides almost immediately when already past the window at mount", () => {
    vi.useFakeTimers();
    const now = new Date();
    vi.setSystemTime(now);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();

    render(
      <PaymentCanceledChip
        canceledAt={tenMinutesAgo}
        label="Payment canceled"
        amountLabel="$50.00"
        windowMs={PAYMENT_CANCELED_CHIP_WINDOW_MS}
      />,
    );
    // remaining clamps to 0 → fades at 0, unmounts after the 400ms buffer.
    act(() => {
      vi.advanceTimersByTime(400 + 10);
    });
    expect(screen.queryByText(/Payment canceled/)).not.toBeInTheDocument();
  });
});
