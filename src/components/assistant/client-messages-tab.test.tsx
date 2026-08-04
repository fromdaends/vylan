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
import type { TeamConversation } from "@/lib/db/team-messages";
import en from "../../../messages/en.json";

// The opened-thread view hosts ClientThread (its own fetch + observers).
// Stub it so these tests stay focused on the inbox list ⇆ thread navigation.
vi.mock("@/components/messages/client-thread", () => ({
  ClientThread: ({ clientId }: { clientId: string }) => (
    <div data-testid="thread">Thread {clientId}</div>
  ),
}));

// Same for the pinned team conversation's thread (its own fetch + poll).
vi.mock("@/components/assistant/team-thread", () => ({
  TeamThread: () => <div data-testid="team-thread">Team thread</div>,
}));

const fetchMock = vi.fn();

const conversations: FirmConversation[] = [
  {
    clientId: "c1",
    clientName: "Acme Corp",
    lastMessage: {
      sender: "client",
      body: "Any update?",
      createdAt: "2026-07-02T09:00:00Z",
    },
    unreadCount: 2,
    lastActivityAt: "2026-07-02T09:00:00Z",
  },
  {
    clientId: "c2",
    clientName: "Beta Inc",
    lastMessage: {
      sender: "firm",
      body: "All done",
      createdAt: "2026-06-01T09:00:00Z",
    },
    unreadCount: 0,
    lastActivityAt: "2026-06-01T09:00:00Z",
  },
  // Never messaged — still listed, so a chat can be started from the inbox.
  {
    clientId: "c3",
    clientName: "Zephyr Ltd",
    lastMessage: null,
    unreadCount: 0,
    lastActivityAt: null,
  },
];

const team: TeamConversation = {
  firmName: "Jette Comptables",
  logoUrl: null,
  unreadCount: 3,
  lastMessage: {
    body: "Standup at 9",
    senderName: "Zach",
    mine: false,
    createdAt: "2026-07-03T08:00:00Z",
  },
};

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
    json: async () => ({ conversations, team: null }),
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
    expect(screen.getByTestId("thread")).toHaveTextContent("Thread c1");

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

  it("lists a client you have never messaged, ready to start one", async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Zephyr Ltd")).toBeInTheDocument(),
    );
    // The preview says there is nothing yet, and no relative time is shown for
    // a conversation that has never happened.
    expect(
      screen.getByText(en.Assistant.messages_no_messages_yet),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Zephyr Ltd/ }));
    expect(screen.getByTestId("thread")).toHaveTextContent("Thread c3");
  });

  it("shows an empty state when the firm has no clients at all", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ conversations: [], team: null }),
    });
    renderTab();
    await waitFor(() =>
      expect(
        screen.getByText(en.Assistant.messages_inbox_no_clients),
      ).toBeInTheDocument(),
    );
  });
});

describe("ClientMessagesTab (pinned team chat)", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ conversations, team }),
    });
  });

  it("pins the firm's team conversation above the client list", async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Jette Comptables")).toBeInTheDocument(),
    );
    // Preview leads with the teammate's name; the subtitle says what it is.
    expect(screen.getByText("Zach: Standup at 9")).toBeInTheDocument();
    expect(screen.getByText(en.TeamChat.thread_title)).toBeInTheDocument();
    // The team row renders before every client row.
    const buttons = screen.getAllByRole("button");
    const teamIdx = buttons.findIndex((b) =>
      b.textContent?.includes("Jette Comptables"),
    );
    const clientIdx = buttons.findIndex((b) =>
      b.textContent?.includes("Acme Corp"),
    );
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(teamIdx).toBeLessThan(clientIdx);
  });

  it("counts team unread into the reported total", async () => {
    const onUnreadTotal = vi.fn();
    renderTab({ onUnreadTotal });
    // 2 client + 3 team.
    await waitFor(() => expect(onUnreadTotal).toHaveBeenCalledWith(5));
    expect(
      screen.getByRole("img", { name: /3 unread/i }),
    ).toBeInTheDocument();
  });

  it("opens the team thread with the firm identity in the header", async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Jette Comptables")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Jette Comptables/ }),
    );
    expect(screen.getByTestId("team-thread")).toBeInTheDocument();
    // The back row carries the firm name + the team-only reassurance.
    expect(screen.getByText("Jette Comptables")).toBeInTheDocument();
    expect(screen.getByText(en.TeamChat.team_only)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: en.Assistant.messages_back_to_inbox,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Acme Corp")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("team-thread")).not.toBeInTheDocument();
  });

  it("shows the pinned row even when there are no client conversations", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ conversations: [], team }),
    });
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Jette Comptables")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(en.Assistant.messages_inbox_no_clients),
    ).toBeInTheDocument();
  });

  it("hides the pinned row for a firm without a team", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ conversations, team: null }),
    });
    renderTab();
    await waitFor(() =>
      expect(screen.getByText("Acme Corp")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Jette Comptables")).not.toBeInTheDocument();
  });
});
