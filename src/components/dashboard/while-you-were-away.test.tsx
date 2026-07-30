import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { WhileYouWereAway } from "./while-you-were-away";
import type { HomeNotification } from "@/lib/home/notifications";
import en from "../../../messages/en.json";

// Stub the locale-aware <Link> (needs next/navigation, absent under vitest)
// with a plain anchor.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

const SEEN_KEY = "vylan:home-seen-at";

function notif(id: string, timestamp: string): HomeNotification {
  return {
    id,
    kind: "document_uploaded",
    engagement_id: `eng-${id}`,
    engagement_title: `Engagement ${id}`,
    client_display_name: "Acme Inc.",
    timestamp,
    href: `/engagements/eng-${id}`,
  };
}

function renderBanner(notifications: HomeNotification[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WhileYouWereAway notifications={notifications} locale="en" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("WhileYouWereAway", () => {
  it("shows nothing on the first ever visit, but records the baseline", () => {
    renderBanner([notif("a", "2026-07-30T10:00:00Z")]);

    expect(screen.queryByText(/While you were away/)).toBeNull();
    // The baseline still got stamped, so the NEXT visit has something to
    // measure against — that's the whole point of a silent first visit.
    expect(localStorage.getItem(SEEN_KEY)).not.toBeNull();
  });

  it("lists only the notifications newer than the stored stamp, newest first", () => {
    localStorage.setItem(SEEN_KEY, "2026-07-30T12:00:00Z");
    renderBanner([
      notif("old", "2026-07-30T09:00:00Z"),
      notif("new1", "2026-07-30T13:00:00Z"),
      notif("new2", "2026-07-30T14:00:00Z"),
    ]);

    expect(screen.getByText("While you were away · 2 updates")).toBeVisible();
    expect(screen.queryByText(/Engagement old/)).toBeNull();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/engagements/eng-new2");
    expect(links[1]).toHaveAttribute("href", "/engagements/eng-new1");
  });

  // The regression this file exists for: the mount effect overwrites the very
  // key the render reads. If the baseline is ever re-read from localStorage
  // instead of frozen at first render, the banner blanks itself the moment it
  // appears — and a re-render (dismissing, new props) is what would expose it.
  it("keeps showing its items after the effect re-stamps the store", () => {
    localStorage.setItem(SEEN_KEY, "2026-07-30T12:00:00Z");
    const items = [notif("new", "2026-07-30T13:00:00Z")];
    const { rerender } = renderBanner(items);

    // The effect has run: the stored stamp is now "now", newer than the item.
    expect(localStorage.getItem(SEEN_KEY)).not.toBe("2026-07-30T12:00:00Z");

    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <WhileYouWereAway notifications={[...items]} locale="en" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("While you were away · 1 update")).toBeVisible();
  });

  it("shows nothing on a second visit once the stamp has moved past everything", () => {
    localStorage.setItem(SEEN_KEY, "2026-07-30T12:00:00Z");
    const items = [notif("new", "2026-07-30T13:00:00Z")];
    renderBanner(items);
    expect(screen.getByText("While you were away · 1 update")).toBeVisible();

    // Second visit = a fresh mount reading the stamp the first visit left.
    cleanup();
    renderBanner(items);
    expect(screen.queryByText(/While you were away/)).toBeNull();
  });

  it("caps the list and reports the remainder", () => {
    localStorage.setItem(SEEN_KEY, "2026-07-30T00:00:00Z");
    const items = Array.from({ length: 8 }, (_, i) =>
      notif(`n${i}`, `2026-07-30T1${i}:00:00Z`),
    );
    renderBanner(items);

    expect(screen.getByText("While you were away · 8 updates")).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByText("+2 more")).toBeVisible();
  });

  it("disappears when dismissed", () => {
    localStorage.setItem(SEEN_KEY, "2026-07-30T12:00:00Z");
    renderBanner([notif("new", "2026-07-30T13:00:00Z")]);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/While you were away/)).toBeNull();
  });

  it("ignores a corrupted stamp rather than showing the whole history", () => {
    localStorage.setItem(SEEN_KEY, "not-a-date");
    renderBanner([notif("a", "2026-07-30T13:00:00Z")]);

    expect(screen.queryByText(/While you were away/)).toBeNull();
  });
});
