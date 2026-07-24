"use client";

// The app sidebar's collapsed state is a client-only preference kept in
// localStorage and broadcast via a custom window event, so any part of the app
// can read or flip it and the AppShell (which subscribes via useSyncExternalStore)
// re-renders. This module is the single source of truth for that contract — the
// shell reads/writes through here, and features (e.g. the SignWell field-placement
// editor, which collapses the rail for room) flip it through the same helpers.

export const SIDEBAR_COLLAPSED_KEY = "vylan:sidebar-collapsed";
export const SIDEBAR_COLLAPSED_EVENT = "vylan:sidebar-collapsed-changed";

export function getSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

// Persist the collapsed state and notify subscribers (the AppShell listens for
// SIDEBAR_COLLAPSED_EVENT). No-ops safely on the server / when storage is blocked.
export function setSidebarCollapsed(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {
    // ignore (storage unavailable / private mode)
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
  }
}
