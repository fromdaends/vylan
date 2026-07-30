"use client";

import { useRef } from "react";
import { openCommentComposer } from "@/components/engagements/comment-thread";

// Opening the comment card FROM A MENU ENTRY, without the card closing again
// the instant it appears.
//
// THE BUG THIS EXISTS FOR: "Add a comment" in the engagement's "..." menu did
// nothing — the card flashed open and vanished. Radix restores focus to the
// element that was focused before a menu opened, and for a "..." menu that is
// the "..." BUTTON. The comment card is a non-modal Popover, so a focus landing
// outside it counts as an interaction-outside and dismisses it. Dispatching the
// open request from the item's onSelect therefore raced the menu's own closing
// focus restore, which won:
//
//   focusOutside -> interactOutside -> onOpenChange(false)   (observed order)
//
// Right-click menus escaped it by luck: right-clicking a plain row focuses
// nothing, so the restore target was <body>, which fires no focusin and left
// the card alone. Lucky, not correct — right-clicking a row straight after
// clicking any button would have restored focus to that button and killed the
// card exactly the same way. So every "Add a comment" entry goes through this,
// dropdown and context menu alike.
//
// THE FIX: remember which thread was asked for, and open it from the menu's
// onCloseAutoFocus — after the menu is gone — with preventDefault() so the menu
// never pulls focus back at all. The card then opens into a settled page and
// puts the caret in its own composer.
export function useCommentFromMenu(): {
  request: (key: string) => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const pendingKey = useRef<string | null>(null);
  return {
    // Call from the menu item's onSelect. Deliberately does NOT open anything
    // yet — the menu is still up at this point.
    request: (key: string) => {
      pendingKey.current = key;
    },
    // Spread onto the menu's Content. A no-op for every other menu entry, so
    // closing the menu any other way keeps Radix's normal focus behaviour.
    onCloseAutoFocus: (event: Event) => {
      const key = pendingKey.current;
      if (key == null) return;
      pendingKey.current = null;
      event.preventDefault();
      openCommentComposer(key);
    },
  };
}
