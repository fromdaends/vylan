"use client";

// Find-a-person filter for the message inbox. Deliberately the smallest thing
// that works: one 32px row, a hairline under it, no box, no button, no chrome —
// it should read as part of the list rather than as a toolbar sitting on top of
// it (founder: "super minimalist… not taking a big spacing of the page").
//
// ONE component and ONE matcher, used by BOTH inbox surfaces (the popup tab and
// the expanded sidebar). They already share ConversationRow; a second copy of
// the filter is exactly the drift the cohesion rule exists to stop.
//
// It searches WHO, not WHAT: client names (and the pinned team row's firm
// name), never message bodies. Typing a name pulls that person up.

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

// Accent- and case-insensitive folding, same shape as doc-type-picker's — "TREMBLAY",
// "tremblay" and "Trembláy" all have to find Tremblay, and half this book is
// French.
export function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// PURE: does `name` match everything typed? Token-based, so "jean trem" finds
// "Jean Tremblay" and word order doesn't matter. An empty/whitespace query
// matches everything (no filter applied). Exported for unit tests.
export function matchesConversation(
  name: string | null | undefined,
  query: string,
): boolean {
  const tokens = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = foldForSearch(name ?? "");
  return tokens.every((token) => haystack.includes(token));
}

export function ConversationSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useTranslations("Assistant");
  const label = t("messages_search_placeholder");

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1">
      <Search
        className="size-3.5 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears rather than closing the panel — there is no visible
          // clear control, by design.
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={label}
        aria-label={label}
        className="h-6 w-full min-w-0 border-0 bg-transparent p-0 text-[12px] leading-none text-foreground outline-none placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0"
      />
    </div>
  );
}
