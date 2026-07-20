import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import {
  PaymentCanceledChip,
  PAYMENT_CANCELED_CHIP_WINDOW_MS,
} from "./payment-canceled-chip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaymentCanceledChip", () => {
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
