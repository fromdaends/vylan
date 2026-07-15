import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ClientMessageRow } from "./client-message-row";
import en from "../../../messages/en.json";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderRow(compact = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ol>
        <ClientMessageRow
          engagement={{ id: "e1", title: "T1 2026", status: "in_progress" }}
          clientName="Marie Tremblay"
          timestamp={new Date().toISOString()}
          locale="en"
          compact={compact}
        />
      </ol>
    </NextIntlClientProvider>,
  );
}

describe("ClientMessageRow", () => {
  it("renders the event title, meta, and Reply chip", () => {
    renderRow();
    expect(screen.getByText(en.Home.kind_client_message)).toBeInTheDocument();
    expect(screen.getByText("Marie Tremblay")).toBeInTheDocument();
    expect(screen.getByText(en.Home.reply)).toBeInTheDocument();
  });

  it("clicking asks the assistant panel to open the engagement's Client-messages tab", () => {
    const dispatched: CustomEvent[] = [];
    const spy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation((e: Event) => {
        dispatched.push(e as CustomEvent);
        return true;
      });

    renderRow();
    fireEvent.click(screen.getByRole("button"));

    expect(spy).toHaveBeenCalled();
    const open = dispatched.find((e) => e.type === "vylan:assistant:open");
    expect(open).toBeTruthy();
    expect(open!.detail).toEqual({
      tab: "messages",
      engagement: {
        id: "e1",
        title: "T1 2026",
        status: "in_progress",
        clientName: "Marie Tremblay",
      },
    });
  });
});
