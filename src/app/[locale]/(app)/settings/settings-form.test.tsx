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
        autoRejectDuplicates={false}
        autoRequestMissingPages={false}
        includeQuebecForms={true}
        aiUsage={{
          used: 0,
          cap: 400,
          paused: false,
          resetsAt: "2026-07-01T00:00:00.000Z",
          isTrial: false,
        }}
        isOwner
        billingSlot={<div>SUBSCRIPTION_SLOT</div>}
        connect={null}
        servicePrices={null}
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

describe("SettingsShell — Account / Security & privacy / Payments", () => {
  it("shows the Account, Security and Payments tabs in the sub-nav", () => {
    renderShell();
    expect(
      screen.getByRole("button", { name: en.Settings.nav_account }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.nav_security }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Settings.nav_payments }),
    ).toBeInTheDocument();
  });

  it("puts email + password (and firm settings) under the Account tab", () => {
    renderShell({ initialSection: "account" });
    expect(screen.getByDisplayValue(EMAIL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.Profile.change_password }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en.Settings.section_firm_settings),
    ).toBeInTheDocument();
  });

  it("puts two-factor + the owner's privacy tools under Security — not email/password", () => {
    renderShell({ initialSection: "security", isOwner: true });
    expect(screen.getByText(en.Profile.mfa_title)).toBeInTheDocument();
    expect(screen.getByText(en.Settings.data_export_label)).toBeInTheDocument();
    // Email + password moved out to Account.
    expect(screen.queryByDisplayValue(EMAIL)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.Profile.change_password }),
    ).not.toBeInTheDocument();
  });

  it("shows the subscription slot only after switching to the Payments tab", () => {
    renderShell({ initialSection: "account" });
    expect(screen.queryByText("SUBSCRIPTION_SLOT")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(EMAIL)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: en.Settings.nav_payments }),
    );
    expect(screen.getByText("SUBSCRIPTION_SLOT")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(EMAIL)).not.toBeInTheDocument();
  });

  it("resolves the legacy ?tab=billing deep link to the Payments section", () => {
    // Old bookmarks/links used ?tab=billing before the subscription card moved
    // under Payments — they must still land on the subscription slot.
    renderShell({ initialSection: "billing" });
    expect(screen.getByText("SUBSCRIPTION_SLOT")).toBeInTheDocument();
  });

  it("renders the Stripe Connect block above the subscription under Payments", () => {
    renderShell({
      initialSection: "payments",
      connect: {
        configured: true,
        accountId: null,
        chargesEnabled: false,
        detailsSubmitted: false,
        onboardedAt: null,
        justReturned: false,
      },
    });
    expect(
      screen.getByText(en.Settings.connect_start_title),
    ).toBeInTheDocument();
    expect(screen.getByText("SUBSCRIPTION_SLOT")).toBeInTheDocument();
  });

  it("hides Payments + the owner-only privacy tools from non-owners but keeps 2FA", () => {
    renderShell({ isOwner: false, billingSlot: null, initialSection: "security" });
    expect(screen.getByText(en.Profile.mfa_title)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.Settings.nav_payments }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(en.Settings.data_export_label),
    ).not.toBeInTheDocument();
  });
});

describe("SettingsShell — AI usage card (Documents tab)", () => {
  it("shows the monthly reset line for a PAID firm", () => {
    renderShell({
      initialSection: "documents",
      aiUsage: {
        used: 12,
        cap: 350,
        paused: false,
        resetsAt: "2026-07-01T00:00:00.000Z",
        isTrial: false,
      },
    });
    // Monthly framing + a real reset date (no "Invalid Date").
    expect(screen.getByText(/used this month/)).toBeInTheDocument();
    expect(screen.getByText(/resets/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("shows trial framing with NO reset line and NO 'Invalid Date' for a capped trial", () => {
    renderShell({
      initialSection: "documents",
      aiUsage: {
        used: 10,
        cap: 10,
        paused: true,
        resetsAt: "", // trials carry no monthly reset — must not become a date
        isTrial: true,
      },
    });
    // Lifetime/trial framing + the upgrade hint…
    expect(
      screen.getByText(/free trial AI checks used/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to keep AI/)).toBeInTheDocument();
    // …and crucially never the monthly reset line or a broken date.
    expect(screen.queryByText(/resets/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/used this month/)).not.toBeInTheDocument();
  });
});
