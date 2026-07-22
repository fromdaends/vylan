import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

// Hoisted so the vi.mock factories below can reference them (vi.mock is hoisted
// above imports).
const { refresh, toastSuccess, toastError, sendReminderAction } = vi.hoisted(
  () => ({
    refresh: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    sendReminderAction: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/app/actions/engagements", () => ({ sendReminderAction }));

import { SendReminderButton } from "./send-reminder-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SendReminderButton engagementId="e1" />
    </NextIntlClientProvider>,
  );
}

const FAILED = "Couldn't send the reminder — please try again";

describe("SendReminderButton", () => {
  it("idle: shows the Send reminder label, enabled, not busy", () => {
    renderButton();
    expect(screen.getByText("Send reminder")).toBeInTheDocument();
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Send reminder" });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute("aria-busy", "true");
  });

  // The core founder fix: the moment it's clicked the button must give LOUD,
  // hover-independent feedback — a "Sending…" label + a pinned-open button —
  // not just a tiny icon swap that collapses when the cursor leaves.
  it("while sending: shows 'Sending…', disabled + aria-busy, pinned open without hover", async () => {
    let resolve!: (v: { ok: boolean }) => void;
    sendReminderAction.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        resolve = r;
      }),
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));

    expect(await screen.findByText("Sending…")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Send reminder" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    // Pinned open: the expanded width is applied unconditionally (not behind a
    // hover: variant that only fires when the cursor is over the button).
    expect(btn.className).toContain("w-40");
    expect(btn.className).not.toContain("hover:w-40");

    resolve({ ok: true });
    await screen.findByText("Send reminder");
  });

  it("on success: success toast + refresh, no error toast", async () => {
    sendReminderAction.mockResolvedValue({ ok: true });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Reminder sent"),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("on ok:false: error toast, no refresh", async () => {
    sendReminderAction.mockResolvedValue({ ok: false });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(FAILED));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("on thrown error: error toast, no refresh", async () => {
    sendReminderAction.mockRejectedValue(new Error("network"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(FAILED));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores repeat clicks while a send is in flight (fires once)", async () => {
    let resolve!: (v: { ok: boolean }) => void;
    sendReminderAction.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        resolve = r;
      }),
    );
    renderButton();
    const btn = screen.getByRole("button", { name: "Send reminder" });
    fireEvent.click(btn);
    await screen.findByText("Sending…");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(sendReminderAction).toHaveBeenCalledTimes(1);

    resolve({ ok: true });
    await screen.findByText("Send reminder");
  });
});
