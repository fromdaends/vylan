import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EngagementMessages } from "./engagement-messages";
import type { ClientMessageRow } from "@/lib/db/client-messages";
import en from "../../../messages/en.json";

// jsdom has no IntersectionObserver; the component only uses it to detect the
// tab becoming visible, which isn't what these tests exercise.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMessages(
  overrides: Partial<Parameters<typeof EngagementMessages>[0]> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EngagementMessages
        engagementId="e1"
        clientName="Marie Tremblay"
        initialMessages={[]}
        notActivated={false}
        readOnly={false}
        readOnlyReason={null}
        locale="en"
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

const sampleMessages: ClientMessageRow[] = [
  {
    id: "m1",
    sender: "firm",
    sender_user_id: "u1",
    sender_name: "Zach",
    body: "Hi Marie, your T4 looks good.",
    created_at: "2026-07-01T10:00:00Z",
  },
  {
    id: "m2",
    sender: "client",
    sender_user_id: null,
    sender_name: "Marie Tremblay",
    body: "Thanks! One question about the RRSP slip.",
    created_at: "2026-07-01T11:00:00Z",
  },
];

describe("EngagementMessages", () => {
  it("shows the client's name in the header and the human-to-human caption", () => {
    renderMessages();
    expect(
      screen.getByText("Messages with Marie Tremblay"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en.ClientMessages.client_receives),
    ).toBeInTheDocument();
  });

  it("renders the empty state with the client's name", () => {
    renderMessages();
    expect(screen.getByText(en.ClientMessages.empty_title)).toBeInTheDocument();
    expect(
      screen.getByText(/Marie Tremblay will see it in their portal/),
    ).toBeInTheDocument();
  });

  it("renders both sides of the thread with sender names and bodies", () => {
    renderMessages({ initialMessages: sampleMessages });
    expect(
      screen.getByText("Hi Marie, your T4 looks good."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Thanks! One question about the RRSP slip."),
    ).toBeInTheDocument();
    // Sender line under each bubble (name · time).
    expect(screen.getByText(/^Zach ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Marie Tremblay ·/)).toBeInTheDocument();
  });

  it("disables Send until something is typed, then posts and appends", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        message: {
          id: "m3",
          sender: "firm",
          sender_user_id: "u1",
          sender_name: "Zach",
          body: "New note",
          created_at: "2026-07-02T10:00:00Z",
        },
      }),
    });

    renderMessages({ initialMessages: sampleMessages });
    const send = screen.getByRole("button", {
      name: new RegExp(en.ClientMessages.send),
    });
    expect(send).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText("Write a message to Marie Tremblay…"),
      { target: { value: "New note" } },
    );
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    await waitFor(() =>
      expect(screen.getByText("New note")).toBeInTheDocument(),
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/engagements/e1/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "New note" });
  });

  it("shows the failure notice when the send is rejected", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "read_only" }),
    });
    renderMessages();
    fireEvent.change(
      screen.getByPlaceholderText("Write a message to Marie Tremblay…"),
      { target: { value: "Hello" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(en.ClientMessages.send) }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        en.ClientMessages.send_failed,
      ),
    );
    // The draft is kept so the accountant can retry without retyping.
    expect(
      screen.getByPlaceholderText("Write a message to Marie Tremblay…"),
    ).toHaveValue("Hello");
  });

  it("hides the composer and explains why on a complete engagement", () => {
    renderMessages({
      initialMessages: sampleMessages,
      readOnly: true,
      readOnlyReason: "complete",
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(en.ClientMessages.read_only_complete),
    ).toBeInTheDocument();
    // History stays visible.
    expect(
      screen.getByText("Hi Marie, your T4 looks good."),
    ).toBeInTheDocument();
  });

  it("shows Seen under the firm's latest message once the client read past it", () => {
    renderMessages({
      initialMessages: sampleMessages,
      initialClientLastReadAt: "2026-07-01T12:00:00Z",
    });
    // sampleMessages: firm at 10:00, client at 11:00; read pointer 12:00 —
    // the (only) firm message is seen.
    expect(screen.getByText(`· ${en.ClientMessages.seen}`)).toBeInTheDocument();
  });

  it("shows no Seen marker while the client hasn't read the latest firm message", () => {
    renderMessages({
      initialMessages: sampleMessages,
      initialClientLastReadAt: "2026-07-01T09:00:00Z",
    });
    expect(
      screen.queryByText(`· ${en.ClientMessages.seen}`),
    ).not.toBeInTheDocument();
  });

  it("shows the quiet gated state before migration 0650", () => {
    renderMessages({ notActivated: true });
    expect(
      screen.getByText(en.ClientMessages.not_activated),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
