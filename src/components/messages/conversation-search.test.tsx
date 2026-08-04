import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ConversationSearch, matchesConversation } from "./conversation-search";
import en from "../../../messages/en.json";

afterEach(cleanup);

describe("matchesConversation", () => {
  it("matches everything when nothing is typed", () => {
    expect(matchesConversation("Acme Corp", "")).toBe(true);
    expect(matchesConversation("Acme Corp", "   ")).toBe(true);
    // A client with no name on file must not vanish from an unfiltered list.
    expect(matchesConversation(null, "")).toBe(true);
  });

  it("matches on any part of the name, case-insensitively", () => {
    expect(matchesConversation("Zachary Thresh", "zach")).toBe(true);
    expect(matchesConversation("Zachary Thresh", "THRESH")).toBe(true);
    expect(matchesConversation("Zachary Thresh", "danny")).toBe(false);
  });

  it("ignores accents in both directions — half this book is French", () => {
    expect(matchesConversation("Marie Lefebvre", "lefebvre")).toBe(true);
    expect(matchesConversation("Jean Trembláy", "tremblay")).toBe(true);
    expect(matchesConversation("Hélène Côté", "helene")).toBe(true);
    expect(matchesConversation("Helene Cote", "hélène")).toBe(true);
  });

  it("matches tokens in any order, so 'trem jean' still finds Jean Tremblay", () => {
    expect(matchesConversation("Jean Tremblay", "trem jean")).toBe(true);
    // Every token has to hit, though.
    expect(matchesConversation("Jean Tremblay", "jean martin")).toBe(false);
  });

  it("has no name to match against without a name", () => {
    expect(matchesConversation(null, "acme")).toBe(false);
    expect(matchesConversation("", "acme")).toBe(false);
  });
});

describe("ConversationSearch", () => {
  function renderSearch(value = "", onChange = vi.fn()) {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationSearch value={value} onChange={onChange} />
      </NextIntlClientProvider>,
    );
    return onChange;
  }

  it("reports what was typed", () => {
    const onChange = renderSearch();
    fireEvent.change(
      screen.getByLabelText(en.Assistant.messages_search_placeholder),
      { target: { value: "zach" } },
    );
    expect(onChange).toHaveBeenCalledWith("zach");
  });

  // There is deliberately no visible clear control (the founder asked for the
  // smallest possible field), so Escape has to be a real way out.
  it("clears on Escape when there is something to clear", () => {
    const onChange = renderSearch("zach");
    fireEvent.keyDown(
      screen.getByLabelText(en.Assistant.messages_search_placeholder),
      { key: "Escape" },
    );
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("leaves Escape alone when the field is already empty, so the panel can close", () => {
    const onChange = renderSearch("");
    fireEvent.keyDown(
      screen.getByLabelText(en.Assistant.messages_search_placeholder),
      { key: "Escape" },
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
