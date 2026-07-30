import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useCommentFromMenu } from "./use-comment-from-menu";
import { commentKeyForEngagement, commentKeyForFile } from "./comment-keys";

// The card is opened by a window CustomEvent; listen for it directly rather
// than mounting a thread, so these assertions are about the menu wiring only.
function listen() {
  const seen: string[] = [];
  const h = (e: Event) => seen.push((e as CustomEvent).detail?.key);
  window.addEventListener("vylan:comments:add", h);
  return {
    seen,
    stop: () => window.removeEventListener("vylan:comments:add", h),
  };
}

function closeEvent() {
  const preventDefault = vi.fn();
  return {
    event: { preventDefault } as unknown as Event,
    preventDefault,
  };
}

afterEach(() => cleanup());

// WHY THESE ASSERTIONS: "Add a comment" in the engagement's "..." menu used to
// dispatch the open request from the item's onSelect, while the menu was still
// closing. The menu's closing focus restore then landed on the "..." button —
// outside the card — and the non-modal Popover dismissed itself the same tick
// it opened (observed: focusOutside -> interactOutside -> onOpenChange(false)).
// The card must therefore be asked for during onSelect but OPENED only once the
// menu is gone, with the focus restore suppressed.
describe("useCommentFromMenu", () => {
  it("does not open the card while the menu is still up", () => {
    const l = listen();
    const { result } = renderHook(() => useCommentFromMenu());
    act(() => result.current.request(commentKeyForEngagement("e1")));
    expect(l.seen).toEqual([]);
    l.stop();
  });

  it("opens it when the menu closes, and blocks the focus restore", () => {
    const l = listen();
    const { result } = renderHook(() => useCommentFromMenu());
    const { event, preventDefault } = closeEvent();
    act(() => {
      result.current.request(commentKeyForEngagement("e1"));
      result.current.onCloseAutoFocus(event);
    });
    expect(l.seen).toEqual(["eng:e1"]);
    // Without this the menu hands focus back to its trigger and the card dies.
    expect(preventDefault).toHaveBeenCalledTimes(1);
    l.stop();
  });

  it("leaves other menu entries alone (no request = normal focus restore)", () => {
    const l = listen();
    const { result } = renderHook(() => useCommentFromMenu());
    const { event, preventDefault } = closeEvent();
    act(() => result.current.onCloseAutoFocus(event));
    expect(l.seen).toEqual([]);
    expect(preventDefault).not.toHaveBeenCalled();
    l.stop();
  });

  it("consumes the request, so reopening the menu doesn't reopen the card", () => {
    const l = listen();
    const { result } = renderHook(() => useCommentFromMenu());
    act(() => {
      result.current.request(commentKeyForFile("f1"));
      result.current.onCloseAutoFocus(closeEvent().event);
    });
    const second = closeEvent();
    act(() => result.current.onCloseAutoFocus(second.event));
    expect(l.seen).toEqual(["file:f1"]);
    expect(second.preventDefault).not.toHaveBeenCalled();
    l.stop();
  });

  it("carries the key of the entry actually chosen", () => {
    const l = listen();
    const { result } = renderHook(() => useCommentFromMenu());
    act(() => {
      result.current.request(commentKeyForFile("f1"));
      result.current.request(commentKeyForEngagement("e2"));
      result.current.onCloseAutoFocus(closeEvent().event);
    });
    expect(l.seen).toEqual(["eng:e2"]);
    l.stop();
  });
});
