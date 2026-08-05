import { describe, it, expect } from "vitest";
import {
  SAVED_VIEWS_MAX,
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SURFACES,
  isSavedViewSurface,
} from "./saved-view";

// ⚠️ THE REASON THIS MODULE EXISTS AT ALL.
//
// These constants started life in lib/db/saved-views.ts, which imports
// getServerSupabase → next/headers. The views MENU is a client component and
// needs the name cap for its input's maxLength, so importing from there pulled
// a server-only module into the browser bundle.
//
// `tsc --noEmit` was clean. 5150 tests passed. Only `next build` said a word:
// "You're importing a module that depends on next/headers." Same trap and same
// fix as lib/clients/note.ts and lib/files/upload-limits.ts.
//
// This test file lives here rather than beside the db module for the same
// reason — importing the server file into a test would hide the split it is
// meant to protect.
describe("saved-view constants live in a client-safe module", () => {
  it("covers exactly the three lists that can hold views", () => {
    expect([...SAVED_VIEW_SURFACES]).toEqual(["engagements", "tasks", "clients"]);
  });

  it("accepts only those three", () => {
    for (const s of SAVED_VIEW_SURFACES) expect(isSavedViewSurface(s)).toBe(true);
    for (const bad of ["files", "", null, undefined, 3, {}, ["tasks"]]) {
      expect(isSavedViewSurface(bad)).toBe(false);
    }
  });

  it("caps a name at something that still reads as a tab", () => {
    // Long enough for "Overdue, mine, this week", short enough that the strip
    // stays a strip.
    expect(SAVED_VIEW_NAME_MAX).toBe(40);
    expect("Overdue, mine, this week".length).toBeLessThanOrEqual(
      SAVED_VIEW_NAME_MAX,
    );
  });

  it("caps how many one list can hold", () => {
    // Past a dozen a tab strip stops being navigation and becomes a search
    // problem.
    expect(SAVED_VIEWS_MAX).toBe(12);
  });
});
