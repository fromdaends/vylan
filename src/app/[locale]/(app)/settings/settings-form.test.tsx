import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";

// SettingsShell pulls in the firm + security sub-forms, which import server
// actions and the locale router. Stub them so the module graph loads under
// vitest (the real "use server" files import next/headers + supabase server).
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: unknown;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/app/actions/profile", () => {
  const ok = async () => ({ ok: true });
  return {
    updateLocaleAction: ok,
    updateEmailAction: ok,
    changePasswordAction: ok,
    updateFirmLogoAction: ok,
    removeFirmLogoAction: ok,
  };
});
vi.mock("@/app/actions/settings", () => ({
  updateFirmSettings: async () => ({ ok: true }),
}));
vi.mock("@/app/actions/mfa", () => {
  const ok = async () => ({ ok: true });
  return {
    enrollMfaAction: ok,
    verifyMfaEnrollAction: ok,
    disableMfaAction: ok,
  };
});

import { SettingsShell } from "./settings-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FIRM = { name: "Acme", brand_color: "#1d4ed8", locale_default: "fr" as const };
const EMAIL = "owner@acme.test";

function renderShell(
  overrides: Partial<React.ComponentProps<typeof SettingsShell>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SettingsShell
        currentLocale="en"
        currentTimezone="America/Toronto"
        autoRejectUnusableDocs={false}
        isOwner
        billingSlot={<div>SUBSCRIPTION_SLOT</div>}
        firmName="Acme"
        firm={FIRM}
        firmLogoUrl={null}
        email={EMAIL}
        mfaEnabled={false}
        initialSection="security"
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("SettingsShell — Security + Billing tabs", () => {
  it("shows distinct Security and Billing tabs in the sub-nav", () => {
    renderShell();
    expect(
      screen.getByRole("button", { name: en.Settings.nav_security }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.nav_billing }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.nav_account }),
    ).toBeInTheDocument();
  });

  it("renders email/password/two-factor AND the owner's privacy tools under one Security tab", () => {
    renderShell({ initialSection: "security", isOwner: true });
    // Email section shows the current address read-only.
    expect(screen.getByDisplayValue(EMAIL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Profile.change_password }),
    ).toBeInTheDocument();
    // Data & privacy is merged in here (owner) — no separate tab.
    expect(screen.getByText(en.Settings.data_export_label)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.Settings.nav_data }),
    ).not.toBeInTheDocument();
  });

  it("shows the subscription slot only after switching to the Billing tab", () => {
    renderShell({ initialSection: "security" });
    expect(screen.queryByText("SUBSCRIPTION_SLOT")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.nav_billing }),
    );
    expect(screen.getByText("SUBSCRIPTION_SLOT")).toBeInTheDocument();
    // The security panel is unmounted once we leave it.
    expect(screen.queryByDisplayValue(EMAIL)).not.toBeInTheDocument();
  });

  it("keeps Security for non-owners but hides Billing + the owner-only privacy tools", () => {
    renderShell({ isOwner: false, billingSlot: null });
    expect(
      screen.getByRole("button", { name: en.Settings.nav_security }),
    ).toBeInTheDocument();
    // Non-owner still gets their own email/password/2FA.
    expect(screen.getByDisplayValue(EMAIL)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.Settings.nav_billing }),
    ).not.toBeInTheDocument();
    // ...but the audit/export/delete tools stay owner-only inside the tab.
    expect(
      screen.queryByText(en.Settings.data_export_label),
    ).not.toBeInTheDocument();
  });
});
