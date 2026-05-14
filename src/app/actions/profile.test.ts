import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const updateUserMock = vi.fn();
const signInMock = vi.fn();
const updateProfileMock = vi.fn();
const uploadBrandingMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: getUserMock,
      signInWithPassword: signInMock,
      updateUser: updateUserMock,
    },
  }),
  getServiceRoleSupabase: () => ({}),
}));
vi.mock("@/lib/db/users", () => ({
  updateUserProfile: (
    patch: Parameters<typeof import("@/lib/db/users").updateUserProfile>[0],
  ) => updateProfileMock(patch),
  userDisplayLabel: (u: { display_name?: string | null; name: string; email: string }) =>
    u.display_name || u.name || u.email,
}));
vi.mock("@/app/actions/branding", () => ({
  uploadBrandingImage: (
    fd: FormData,
    kind: "firm_logo" | "user_avatar",
  ) => uploadBrandingMock(fd, kind),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  updateDisplayNameAction,
  updateLocaleAction,
  updateAvatarAction,
  removeAvatarAction,
  changePasswordAction,
} from "./profile";

function fdWith(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const authedUser = { id: "user-1", email: "u@firm.com" };

describe("profile actions — auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: null } });
  });

  it("updateDisplayNameAction returns unauth when not signed in", async () => {
    const res = await updateDisplayNameAction(fdWith({ display_name: "Jane" }));
    expect(res).toEqual({ ok: false, error: "unauth" });
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("updateLocaleAction returns unauth when not signed in", async () => {
    const res = await updateLocaleAction(fdWith({ locale: "fr" }));
    expect(res).toEqual({ ok: false, error: "unauth" });
  });

  it("updateAvatarAction returns unauth when not signed in", async () => {
    const res = await updateAvatarAction(new FormData());
    expect(res).toEqual({ ok: false, error: "unauth" });
    expect(uploadBrandingMock).not.toHaveBeenCalled();
  });

  it("removeAvatarAction returns unauth when not signed in", async () => {
    const res = await removeAvatarAction();
    expect(res).toEqual({ ok: false, error: "unauth" });
  });

  it("changePasswordAction returns unauth when not signed in", async () => {
    const res = await changePasswordAction(
      fdWith({ current_password: "a1b2c3d4", new_password: "newpass123" }),
    );
    expect(res).toEqual({ ok: false, error: "unauth" });
  });
});

describe("profile actions — happy paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: authedUser } });
    updateProfileMock.mockResolvedValue({ id: "user-1" });
  });

  it("updateDisplayNameAction trims and saves", async () => {
    const res = await updateDisplayNameAction(
      fdWith({ display_name: "  Jane Tremblay  " }),
    );
    expect(res).toEqual({ ok: true });
    expect(updateProfileMock).toHaveBeenCalledWith({
      display_name: "Jane Tremblay",
    });
  });

  it("updateDisplayNameAction treats empty string as null", async () => {
    const res = await updateDisplayNameAction(fdWith({ display_name: "" }));
    expect(res).toEqual({ ok: true });
    expect(updateProfileMock).toHaveBeenCalledWith({ display_name: null });
  });

  it("updateLocaleAction persists fr/en", async () => {
    await updateLocaleAction(fdWith({ locale: "en" }));
    expect(updateProfileMock).toHaveBeenCalledWith({ locale: "en" });
  });

  it("updateLocaleAction rejects an invalid locale", async () => {
    const res = await updateLocaleAction(fdWith({ locale: "de" }));
    expect(res).toEqual({ ok: false, error: "invalid" });
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("updateAvatarAction delegates to uploadBrandingImage + persists path", async () => {
    uploadBrandingMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://signed/firms/f1/users/user-1/avatar-x.jpg",
      path: "firms/f1/users/user-1/avatar-x.jpg",
    });
    const fd = new FormData();
    fd.append(
      "file",
      new File([new Uint8Array(Buffer.from("x"))], "x.png", {
        type: "image/png",
      }),
    );
    const res = await updateAvatarAction(fd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.signedUrl).toContain("avatar-x.jpg");
    expect(uploadBrandingMock).toHaveBeenCalledWith(fd, "user_avatar");
    expect(updateProfileMock).toHaveBeenCalledWith({
      avatar_path: "firms/f1/users/user-1/avatar-x.jpg",
    });
  });

  it("updateAvatarAction surfaces upload_failed", async () => {
    uploadBrandingMock.mockResolvedValue({ ok: false, error: "too_large" });
    const res = await updateAvatarAction(new FormData());
    expect(res).toEqual({ ok: false, error: "upload_failed" });
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("removeAvatarAction clears avatar_path to null", async () => {
    const res = await removeAvatarAction();
    expect(res).toEqual({ ok: true });
    expect(updateProfileMock).toHaveBeenCalledWith({ avatar_path: null });
  });

  it("changePasswordAction verifies + updates on success", async () => {
    signInMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    const res = await changePasswordAction(
      fdWith({ current_password: "currentPass1", new_password: "newPass1234" }),
    );
    expect(res).toEqual({ ok: true });
    expect(signInMock).toHaveBeenCalledWith({
      email: "u@firm.com",
      password: "currentPass1",
    });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "newPass1234" });
  });

  it("changePasswordAction returns wrong_password if current is bad", async () => {
    signInMock.mockResolvedValue({ error: { message: "Invalid login" } });
    const res = await changePasswordAction(
      fdWith({ current_password: "bad12345", new_password: "newPass1234" }),
    );
    expect(res).toEqual({ ok: false, error: "wrong_password" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("changePasswordAction returns weak_password if new is < 8 chars", async () => {
    const res = await changePasswordAction(
      fdWith({ current_password: "currentPass1", new_password: "short" }),
    );
    expect(res).toEqual({ ok: false, error: "weak_password" });
    expect(signInMock).not.toHaveBeenCalled();
  });
});
