import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ClientMessagesTab } from "./client-messages-tab";
import type { FirmConversation } from "@/lib/db/client-messages";
import en from "../../../messages/en.json";

// The opened-thread view hosts EngagementMessages (its own fetch + observers).
// Stub it so these tests stay focused on the inbox list ⇆ thread navigation.
vi.mock("@/components/engagements/engagement-messages", () => ({
  EngagementMessages: ({ engagementId }: { engagementId: string }) => (
    <div data-testid="thread">Thread {engagementId}</div>
  ),
}));

const fetchMock = vi.fn();

const conversations: FirmConversation[] = [
  {
    engagementId: "e1",
    engagementTitle: "GST/QST 2026",
    clientName: "Acme Corp",
    status: "in_progress",
    lastMessage: {
      sender: "client",
      body: "Any update?",
      createdAt: "2026-07-02T09:00:00Z",
    },
    unreadCount: 2,
    lastActivityAt: "2026-07-02T09:00:00Z",
  },
  {
    engagementId: "e2",
    engagementTitle: "T1 2025",
    clientName: "Beta Inc",
    status: "complete",
    lastMessage: {
      sender: "firm",
      body: "All done",
      createdAt: "2026-06-01T09:00:00Z",
    },
    unreadCount: 0,
    lastActivityAt: "2026-06-01T09:00:00Z",
  },
];

function renderTab(
  overrides: Partial<Parameters<typeof ClientMessagesTab>[0]> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ClientMessagesTab locale="en" active {...overrides} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ conversations }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientMessagesTab (inbox)", () => {
  it("lists every client conversation with previews and an unread dot", async () => {
    const onUnreadTotal = vi.fn();
    renderTab({ onUnreadTotal });

    await waitFor(() =>
      expect(screen.getByText("Acme Corp")).toBeInTheDocument(),
    );
    expect(screen.getByText("Beta Inc")).toBeInTheDocument();
    // Client's last message shows raw; the firm's is prefixed "You: ".
    expect(screen.getByText("Any update?")).toBeInTheDocument();
    expect(screen.getByText("You: All done")).toBeInTheDocument();
    // Only the unread conversation carries the blue dot (labeled for a11y).
    expect(screen.getByRole("img", { name: /2 unread/i })).toBeInTheDocument();
    // Total unread is reported up for the tab/FAB badge.
    await waitFor(() => expect(onUnreadTotal).toHaveBeenCalledWith(2));
  });

  it("opens a conversation's thread and returns to the inbox", async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Acme Corp")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Acme Corp/ }));
    expect(screen.getByTestId("thread")).toHaveTextContent("Thread e1");

    fireEvent.click(
      screen.getByRole("button", {
        name: en.Assistant.messages_back_to_inbox,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Beta Inc")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no conversations", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ conversations: [] }),
    });
    renderTab();
    await waitFor(() =>
      expect(
        screen.getByText(en.Assistant.messages_inbox_empty),
      ).toBeInTheDocument(),
    );
  });
});
