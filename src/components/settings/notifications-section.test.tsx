import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

vi.mock("@/app/actions/notifications", () => ({
  saveNotificationSettingsAction: async () => ({ ok: true }),
  unmuteEntityAction: async () => ({ ok: true }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// next-intl's client navigation reaches for next/navigation, which happy-dom
// cannot resolve. Same stub the settings-form test uses.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
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

import { NotificationsSection } from "./notifications-section";
import { NOTIFICATION_EVENTS, labelKeyFor } from "@/lib/notifications/catalog";
import type { RecipientSettings } from "@/lib/notifications/resolve";

afterEach(cleanup);

const SETTINGS: RecipientSettings = {
  emailEnabled: true,
  scope: "all_firm",
  emailMode: "instant",
  dailyDigestTime: "08:00",
  timezone: "America/Toronto",
  quietHoursEnabled: false,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  pauseWeekends: false,
  emailDetailLevel: "full",
};

function renderSection(
  overrides: Partial<React.ComponentProps<typeof NotificationsSection>> = {},
  locale: "en" | "fr" = "en",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : fr}>
      <NotificationsSection
        isOwner
        initialSettings={SETTINGS}
        initialPreferences={[]}
        mutes={[]}
        schemaReady
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("NotificationsSection", () => {
  it("renders the delivery, events, quiet hours and muted sections", () => {
    renderSection();
    expect(screen.getByText(en.Notifications.delivery_title)).toBeTruthy();
    expect(screen.getByText(en.Notifications.events_title)).toBeTruthy();
    expect(screen.getByText(en.Notifications.quiet_title)).toBeTruthy();
    expect(screen.getByText(en.Notifications.muted_title)).toBeTruthy();
  });

  it("puts the scope selector above the switch wall", () => {
    // The single most consequential control on the page; if it ends up buried
    // inside the categories nobody will find it.
    renderSection();
    const scope = screen.getByText(en.Notifications.scope_label);
    const events = screen.getByText(en.Notifications.events_title);
    expect(
      events.compareDocumentPosition(scope) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens Documents and Engagements, leaves the rest collapsed", () => {
    renderSection();
    // An open category shows its event rows.
    expect(
      screen.getByText(en.Notifications.event_document_uploaded_label),
    ).toBeTruthy();
    expect(
      screen.getByText(en.Notifications.event_engagement_overdue_label),
    ).toBeTruthy();
    // A collapsed one shows only its heading.
    expect(
      screen.queryByText(en.Notifications.event_payment_received_label),
    ).toBeNull();
  });

  // ── Acceptance criterion 6 ────────────────────────────────────────────────
  it("renders locked events with disabled switches", () => {
    renderSection();
    // signature.declined is canDisable:false and lives in a collapsed category,
    // so open Signatures first.
    fireEvent.click(screen.getByText(en.Notifications.cat_signatures));
    const row = screen
      .getByText(en.Notifications.event_signature_declined_label)
      .closest("li");
    expect(row).toBeTruthy();
    const switches = within(row as HTMLElement).getAllByRole("switch");
    expect(switches).toHaveLength(2);
    for (const s of switches) {
      expect(s.getAttribute("disabled")).not.toBeNull();
      expect(s.getAttribute("aria-checked")).toBe("true");
    }
  });

  // Owner-only events are HIDDEN from staff, not greyed out.
  it("hides owner-only events from staff entirely", () => {
    renderSection({ isOwner: false });
    // Every owner-only firm event stays hidden — a staff member has no business
    // seeing that the subscription card failed.
    expect(
      screen.queryByText(en.Notifications.event_billing_payment_failed_label),
    ).toBeNull();
    expect(
      screen.queryByText(en.Notifications.event_integration_sync_failed_label),
    ).toBeNull();
  });

  it("shows staff the ONE firm event that is theirs — their own KPI alerts", () => {
    // The "Your firm" heading used to be invisible to staff because every
    // event under it was owner-only. firm.kpi_alert (1690) is deliberately
    // not: anybody may watch a number, and a Junior asking to be told when
    // overdue work passes ten is exactly what the bell is for.
    renderSection({ isOwner: false });
    // The heading is now visible to staff at all — it was not before.
    const heading = screen.getByText(en.Notifications.cat_firm);
    expect(heading).toBeTruthy();
    // "Your firm" is collapsed by default (only Documents and Engagements
    // open), so open it to see the row.
    fireEvent.click(heading);
    expect(
      screen.getByText(en.Notifications.event_firm_kpi_alert_label),
    ).toBeTruthy();
  });

  it("shows owner-only events to an owner", () => {
    renderSection({ isOwner: true });
    expect(screen.getByText(en.Notifications.cat_firm)).toBeTruthy();
  });

  it("disables Save until something changes", () => {
    renderSection();
    const save = screen.getByRole("button", { name: en.Notifications.save });
    expect(save.getAttribute("disabled")).not.toBeNull();
  });

  it("shows a notice when the migration is not applied", () => {
    renderSection({ schemaReady: false });
    expect(screen.getAllByText(en.Notifications.schema_missing).length).toBeGreaterThan(0);
  });

  it("shows the muted empty state and points at where to mute", () => {
    renderSection();
    expect(screen.getByText(en.Notifications.muted_empty)).toBeTruthy();
    expect(screen.getByText(en.Notifications.muted_empty_hint)).toBeTruthy();
  });

  it("lists a muted engagement with its client and an unmute button", () => {
    renderSection({
      mutes: [
        {
          entity_type: "engagement",
          entity_id: "11111111-1111-1111-1111-111111111111",
          created_at: "2026-07-27T12:00:00.000Z",
          label: "T1 2025",
          sublabel: "Gestion Lavoie",
        },
      ],
    });
    expect(screen.getByText("T1 2025")).toBeTruthy();
    expect(screen.getByText("Gestion Lavoie")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: en.Notifications.unmute }),
    ).toBeTruthy();
  });

  it("keeps a mute whose target was deleted, so it can still be cleared", () => {
    renderSection({
      mutes: [
        {
          entity_type: "client",
          entity_id: "22222222-2222-2222-2222-222222222222",
          created_at: "2026-07-27T12:00:00.000Z",
          label: null,
          sublabel: null,
        },
      ],
    });
    expect(screen.getByText(en.Notifications.muted_deleted)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: en.Notifications.unmute }),
    ).toBeTruthy();
  });

  // ── Acceptance criterion 7 ────────────────────────────────────────────────
  it("renders entirely in French with no key leakage", () => {
    const { container } = renderSection({}, "fr");
    expect(screen.getByText(fr.Notifications.delivery_title)).toBeTruthy();
    expect(screen.getByText(fr.Notifications.events_title)).toBeTruthy();
    expect(screen.getByText(fr.Notifications.quiet_title)).toBeTruthy();
    expect(
      screen.getByText(fr.Notifications.event_document_uploaded_label),
    ).toBeTruthy();
    // A missing key renders as the raw key name — catch any that leaked.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/event_[a-z_]+_(label|desc)/);
    expect(text).not.toMatch(/Notifications\./);
  });

  it("has an EN and FR string for every catalog event label", () => {
    // The UI resolves labels by key at render time, so a missing one is only
    // visible as a raw key on screen — assert it directly instead.
    for (const e of NOTIFICATION_EVENTS) {
      const key = labelKeyFor(e.key) as keyof typeof en.Notifications;
      expect(en.Notifications[key], `EN missing ${key}`).toBeTruthy();
      expect(
        fr.Notifications[key as keyof typeof fr.Notifications],
        `FR missing ${key}`,
      ).toBeTruthy();
    }
  });
});
