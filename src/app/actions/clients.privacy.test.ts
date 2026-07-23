import { describe, it, expect, vi, beforeEach } from "vitest";

// Team Wave 4 — behavioral guardrails for setClientPrivacyAction: the owner
// gate (this is OWNER privacy — staff must be refused before any DB write), the
// team-mode gate, the graceful-degradation passthrough (0810 not applied yet →
// "unavailable", never a throw/log), and that success logs the audit entry.

const getCurrentUserMock = vi.fn();
const getCurrentFirmMock = vi.fn();
const setClientPrivacyMock = vi.fn();
const logUserActivityMock = vi.fn();
const hasActiveTeamMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/db/clients", () => ({
  setClientPrivacy: (...a: unknown[]) => setClientPrivacyMock(...a),
}));
vi.mock("@/lib/db/users", () => ({
  getCurrentUser: () => getCurrentUserMock(),
  listActiveFirmUsers: vi.fn(),
}));
vi.mock("@/lib/db/firms", () => ({
  getCurrentFirm: () => getCurrentFirmMock(),
}));
vi.mock("@/lib/team/mode", () => ({
  hasActiveTeam: (...a: unknown[]) => hasActiveTeamMock(...a),
}));
vi.mock("@/lib/db/activity", () => ({
  logUserActivity: (...a: unknown[]) => logUserActivityMock(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({}),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathMock(...a),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ getPathname: vi.fn() }));

import { setClientPrivacyAction } from "./clients";

const owner = { id: "u-owner", role: "owner" };
const staff = { id: "u-staff", role: "staff" };
const firm = { id: "firm-1", team_enabled: true };

describe("setClientPrivacyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(owner);
    getCurrentFirmMock.mockResolvedValue(firm);
    hasActiveTeamMock.mockReturnValue(true);
    setClientPrivacyMock.mockResolvedValue({ ok: true });
  });

  it("refuses a staff caller before any DB write", async () => {
    getCurrentUserMock.mockResolvedValue(staff);
    const res = await setClientPrivacyAction("c-1", true);
    expect(res).toEqual({ ok: false, error: "owner_only" });
    expect(setClientPrivacyMock).not.toHaveBeenCalled();
    expect(logUserActivityMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await setClientPrivacyAction("c-1", true);
    expect(res).toEqual({ ok: false, error: "no_session" });
    expect(setClientPrivacyMock).not.toHaveBeenCalled();
  });

  it("refuses outside team mode", async () => {
    hasActiveTeamMock.mockReturnValue(false);
    const res = await setClientPrivacyAction("c-1", true);
    expect(res).toEqual({ ok: false, error: "not_team" });
    expect(setClientPrivacyMock).not.toHaveBeenCalled();
  });

  it("passes through 'unavailable' (migration not applied) without logging", async () => {
    setClientPrivacyMock.mockResolvedValue({ ok: false, error: "unavailable" });
    const res = await setClientPrivacyAction("c-1", true);
    expect(res).toEqual({ ok: false, error: "unavailable" });
    expect(logUserActivityMock).not.toHaveBeenCalled();
  });

  it("maps a DB failure to update_failed without logging", async () => {
    setClientPrivacyMock.mockResolvedValue({ ok: false, error: "update_failed" });
    const res = await setClientPrivacyAction("c-1", true);
    expect(res).toEqual({ ok: false, error: "update_failed" });
    expect(logUserActivityMock).not.toHaveBeenCalled();
  });

  it("sets, logs the audit entry, and revalidates on success", async () => {
    const res = await setClientPrivacyAction("c-9", true);
    expect(res).toEqual({ ok: true });
    expect(setClientPrivacyMock).toHaveBeenCalledWith("c-9", true, "firm-1");
    expect(logUserActivityMock).toHaveBeenCalledWith(
      "firm-1",
      null,
      "client_privacy_changed",
      { client_id: "c-9", is_private: true },
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it("also handles turning privacy OFF", async () => {
    const res = await setClientPrivacyAction("c-9", false);
    expect(res).toEqual({ ok: true });
    expect(setClientPrivacyMock).toHaveBeenCalledWith("c-9", false, "firm-1");
    expect(logUserActivityMock).toHaveBeenCalledWith(
      "firm-1",
      null,
      "client_privacy_changed",
      { client_id: "c-9", is_private: false },
    );
  });
});
