import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { ReminderAutomationDefaults } from "./reminder-automation-defaults";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.refresh.mockClear();
});

describe("ReminderAutomationDefaults", () => {
  it("keeps the saved editor visible and refreshes stale route data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ReminderAutomationDefaults initialSettings={null} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: en.Settings.reminder_defaults_create,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: en.Settings.reminder_defaults_save,
      }),
    );

    await waitFor(() => {
      expect(navigation.refresh).toHaveBeenCalledOnce();
    });
    expect(
      screen.queryByRole("button", {
        name: en.Settings.reminder_defaults_create,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(en.Settings.reminder_defaults_saved),
    ).toBeInTheDocument();
  });
});
