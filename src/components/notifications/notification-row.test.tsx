import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";

const setRead = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const dismiss = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock("@/app/actions/notifications", () => ({
  setNotificationReadAction: setRead,
  dismissNotificationAction: dismiss,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({
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

import { NotificationRow } from "./notification-row";
import type { FeedItem } from "@/lib/notifications/feed";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "n1",
    eventKey: "document.uploaded",
    labelKey: "event_document_uploaded_label",
    category: "documents",
    href: "/engagements/e1",
    createdAt: new Date().toISOString(),
    readAt: null,
    clientName: "Gestion Lavoie",
    engagementTitle: "T1 2025",
    actorName: null,
    count: 1,
    note: null,
    ...overrides,
  };
}

function renderRow(overrides: Partial<FeedItem> = {}, onChanged = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NotificationRow item={item(overrides)} locale="en" onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
  return onChanged;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("NotificationRow", () => {
  it("shows the event label and its context", () => {
    renderRow();
    expect(
      screen.getByText(en.Notifications.event_document_uploaded_label),
    ).toBeTruthy();
    expect(screen.getByText("T1 2025")).toBeTruthy();
    expect(screen.getByText("Gestion Lavoie")).toBeTruthy();
  });

  it("shows a bundled count instead of repeating the row", () => {
    renderRow({ count: 8 });
    expect(screen.getByText("8")).toBeTruthy();
  });

  // The founder's "blue thing next to it".
  it("marks an unread row with a brand accent bar and drops it once read", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NotificationRow item={item()} locale="en" />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector(".bg-primary")).toBeTruthy();
    cleanup();

    const read = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NotificationRow
          item={item({ readAt: new Date().toISOString() })}
          locale="en"
        />
      </NextIntlClientProvider>,
    );
    expect(read.container.querySelector(".bg-primary")).toBeNull();
  });

  // The bug this test exists for: nesting the menu button INSIDE the row's
  // Link is invalid HTML, and stopping the anchor navigating needs
  // preventDefault — which Radix's asChild trigger treats as "handled", so the
  // menu silently never opens. They must be siblings.
  it("does not nest the actions button inside the link", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NotificationRow item={item()} locale="en" />
      </NextIntlClientProvider>,
    );
    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor!.querySelector("button")).toBeNull();
  });

  it("opens the actions menu and marks the row read", async () => {
    const onChanged = renderRow();
    fireEvent.pointerDown(
      screen.getByLabelText(en.Notifications.row_actions),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    const markRead = await screen.findByText(en.Notifications.mark_read);
    fireEvent.click(markRead);
    expect(onChanged).toHaveBeenCalledWith("n1", "read");
    expect(setRead).toHaveBeenCalledWith({ id: "n1", read: true });
  });

  it("deletes from the actions menu", async () => {
    const onChanged = renderRow();
    fireEvent.pointerDown(
      screen.getByLabelText(en.Notifications.row_actions),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(await screen.findByText(en.Notifications.delete));
    expect(onChanged).toHaveBeenCalledWith("n1", "deleted");
    expect(dismiss).toHaveBeenCalledWith({ id: "n1" });
  });

  it("offers Mark as unread on a row that is already read", async () => {
    renderRow({ readAt: new Date().toISOString() });
    fireEvent.pointerDown(
      screen.getByLabelText(en.Notifications.row_actions),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    expect(await screen.findByText(en.Notifications.mark_unread)).toBeTruthy();
  });

  it("marks read when the row itself is opened", () => {
    const onChanged = renderRow();
    fireEvent.click(
      screen.getByText(en.Notifications.event_document_uploaded_label),
    );
    expect(onChanged).toHaveBeenCalledWith("n1", "read");
  });

  it("does not re-mark an already-read row on open", () => {
    const onChanged = renderRow({ readAt: new Date().toISOString() });
    fireEvent.click(
      screen.getByText(en.Notifications.event_document_uploaded_label),
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(setRead).not.toHaveBeenCalled();
  });

  it("points at the entity it is about", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NotificationRow item={item({ href: "/clients/c1" })} locale="en" />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/clients/c1");
  });
});
