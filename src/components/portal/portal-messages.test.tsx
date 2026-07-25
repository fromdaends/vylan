import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PortalMessages } from "./portal-messages";
import type { PortalMessage } from "@/lib/db/client-messages";
import en from "../../../messages/en.json";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  // The mount effect always fires the read stamp; give it a benign default.
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPortalMessages(
  overrides: Partial<Parameters<typeof PortalMessages>[0]> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PortalMessages
        token={"t".repeat(43)}
        firmName="Cabinet Tremblay"
        initialMessages={[]}
        readOnly={false}
        locale="en"
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

const sampleMessages: PortalMessage[] = [
  {
    id: "m1",
    sender: "firm",
    sender_name: "Zach",
    body: "Hi Marie, could you confirm your address?",
    created_at: "2026-07-01T10:00:00Z",
  },
  {
    id: "m2",
    sender: "client",
    sender_name: "Marie Tremblay",
    body: "Sure, it's 12 Main St.",
    created_at: "2026-07-01T11:00:00Z",
  },
];

describe("PortalMessages", () => {
  it("stamps the read pointer on open", async () => {
    renderPortalMessages();
    await waitFor(() => {
      const readCall = fetchMock.mock.calls.find(
        ([url]) => url === "/api/portal/messages/read",
      );
      expect(readCall).toBeTruthy();
      expect(JSON.parse(readCall![1].body as string)).toEqual({
        token: "t".repeat(43),
      });
    });
  });

  it("renders the thread with sender names on both sides", () => {
    renderPortalMessages({ initialMessages: sampleMessages });
    expect(
      screen.getByText("Hi Marie, could you confirm your address?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sure, it's 12 Main St.")).toBeInTheDocument();
    expect(screen.getByText(/^Zach ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Marie Tremblay ·/)).toBeInTheDocument();
  });

  it("shows the no-attachments nudge without a navigation link", () => {
    renderPortalMessages();
    expect(screen.getByText(en.Portal.messages_nudge)).toBeInTheDocument();
    expect(screen.queryByText("Go to my documents")).not.toBeInTheDocument();
  });

  it("sends a message and appends it to the thread", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/portal/messages/send") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            message: {
              id: "m9",
              sender: "client",
              sender_name: "Marie Tremblay",
              body: "A new question",
              created_at: "2026-07-02T10:00:00Z",
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    renderPortalMessages({ initialMessages: sampleMessages });
    const send = screen.getByRole("button", {
      name: new RegExp(en.Portal.messages_send),
    });
    expect(send).toBeDisabled();
    expect(send.textContent).toBe("");
    fireEvent.change(
      screen.getByPlaceholderText(en.Portal.messages_placeholder),
      { target: { value: "A new question" } },
    );
    fireEvent.click(send);

    await waitFor(() =>
      expect(screen.getByText("A new question")).toBeInTheDocument(),
    );
    const sendCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/portal/messages/send",
    );
    expect(JSON.parse(sendCall![1].body as string)).toEqual({
      token: "t".repeat(43),
      body: "A new question",
    });
  });

  it("sends with Enter and leaves Shift+Enter available for a new line", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/portal/messages/send") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            message: {
              id: "m10",
              sender: "client",
              sender_name: "Marie Tremblay",
              body: "Keyboard message",
              created_at: "2026-07-02T10:00:00Z",
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    renderPortalMessages();
    const composer = screen.getByPlaceholderText(
      en.Portal.messages_placeholder,
    );
    fireEvent.change(composer, { target: { value: "Keyboard message" } });

    expect(
      fireEvent.keyDown(composer, { key: "Enter", shiftKey: true }),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/portal/messages/send",
      ),
    ).toHaveLength(0);

    expect(fireEvent.keyDown(composer, { key: "Enter" })).toBe(false);
    await waitFor(() =>
      expect(screen.getByText("Keyboard message")).toBeInTheDocument(),
    );
  });

  it("keeps the draft and shows the failure notice when the send fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/portal/messages/send") {
        return { ok: false, json: async () => ({ error: "read_only" }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    renderPortalMessages();
    fireEvent.change(
      screen.getByPlaceholderText(en.Portal.messages_placeholder),
      { target: { value: "Hello" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(en.Portal.messages_send),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        en.Portal.messages_send_failed,
      ),
    );
    expect(
      screen.getByPlaceholderText(en.Portal.messages_placeholder),
    ).toHaveValue("Hello");
  });

  it("closes the composer with a note on a completed engagement", () => {
    renderPortalMessages({
      initialMessages: sampleMessages,
      readOnly: true,
    });
    expect(
      screen.queryByPlaceholderText(en.Portal.messages_placeholder),
    ).not.toBeInTheDocument();
    expect(screen.getByText(en.Portal.messages_read_only)).toBeInTheDocument();
    // History stays visible.
    expect(screen.getByText("Sure, it's 12 Main St.")).toBeInTheDocument();
  });
});
