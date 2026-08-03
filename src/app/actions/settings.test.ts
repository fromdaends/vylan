import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsSchema } from "./settings.schema";

// Module mocks — set up before importing the SUT.
const updateCurrentFirmMock = vi.fn(async (patch: Record<string, unknown>) => ({
  id: "firm-1",
  ...patch,
}));
const getCurrentUserMock = vi.fn(async () => ({
  id: "user-1",
  role: "owner" as string,
}));

vi.mock("@/lib/db/firms", () => ({
  updateCurrentFirm: (patch: Record<string, unknown>) =>
    updateCurrentFirmMock(patch),
}));
vi.mock("@/lib/db/users", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const BASE = {
  name: "Cabinet Test",
  brand_color: "#1e293b",
  timezone: "America/Toronto",
  locale_default: "fr",
};

describe("SettingsSchema — auto_reject_unusable_docs coercion", () => {
  // The firm-details form renders NO auto-reject control, so the key must be
  // ABSENT from the parsed output — not present-and-false. updateFirmSettings
  // hands the whole parsed object to updateCurrentFirm, which writes every key
  // it receives, so a materialised `false` silently switches the firm's
  // auto-reject setting off whenever someone saves their firm name.
  it("omits the field entirely when the form does not send it", () => {
    const out = SettingsSchema.parse({ ...BASE });
    expect(Object.hasOwn(out, "auto_reject_unusable_docs")).toBe(false);
    expect(out.auto_reject_unusable_docs).toBeUndefined();
  });

  it("does not serialize the field when the form does not send it", () => {
    // The patch reaches PostgREST as JSON. This is the property that actually
    // keeps the column untouched, so assert it directly rather than trusting
    // the shape of the parsed object.
    const out = SettingsSchema.parse({ ...BASE });
    expect(JSON.stringify(out)).not.toContain("auto_reject_unusable_docs");
  });

  it("treats the browser checkbox 'on' value as true", () => {
    // HTML checkboxes serialize to "on" when checked and to nothing
    // when unchecked, so the action must coerce that string to a
    // strict boolean before passing to the DB.
    const out = SettingsSchema.parse({
      ...BASE,
      auto_reject_unusable_docs: "on",
    });
    expect(out.auto_reject_unusable_docs).toBe(true);
  });

  it("treats a literal boolean true as true", () => {
    const out = SettingsSchema.parse({
      ...BASE,
      auto_reject_unusable_docs: true,
    });
    expect(out.auto_reject_unusable_docs).toBe(true);
  });

  it("treats any other string as false (off)", () => {
    // Anything that isn't "on" / "true" / true is off. Belt-and-
    // suspenders: a malformed form post can't accidentally flip the
    // firm into auto-reject mode.
    const out = SettingsSchema.parse({
      ...BASE,
      auto_reject_unusable_docs: "false",
    });
    expect(out.auto_reject_unusable_docs).toBe(false);
  });

  it("still validates the other required fields", () => {
    // Sanity: turning the flag on does not bypass min length on name.
    const result = SettingsSchema.safeParse({
      ...BASE,
      name: "x",
      auto_reject_unusable_docs: "on",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateFirmSettings — the patch it hands to the database", () => {
  beforeEach(() => {
    updateCurrentFirmMock.mockClear();
    getCurrentUserMock.mockResolvedValue({ id: "user-1", role: "owner" });
  });

  // Exactly what src/components/settings/firm-settings-sections.tsx posts.
  function firmDetailsForm(): FormData {
    const fd = new FormData();
    fd.set("name", "Cabinet Test");
    fd.set("brand_color", "#1e293b");
    fd.set("locale_default", "fr");
    return fd;
  }

  it("never writes auto_reject_unusable_docs when saving firm details", async () => {
    // THE REGRESSION. An owner turns auto-reject ON in Settings -> Documents,
    // then later edits the firm name in Settings -> Account. That save must not
    // touch the auto-reject column, in either direction.
    const { updateFirmSettings } = await import("./settings");
    const result = await updateFirmSettings(null, firmDetailsForm());

    expect(result).toEqual({ ok: true });
    expect(updateCurrentFirmMock).toHaveBeenCalledTimes(1);

    const patch = updateCurrentFirmMock.mock.calls[0]![0];
    expect(Object.hasOwn(patch, "auto_reject_unusable_docs")).toBe(false);
    expect(Object.keys(patch).sort()).toEqual([
      "brand_color",
      "locale_default",
      "name",
    ]);
  });

  it("writes only the keys the form actually sent", async () => {
    // Same rule, stated generally: any column owned by a dedicated route
    // (timezone, auto-reject) must stay out of this patch. A field added to
    // SettingsSchema with .default() would fail this test, which is the point.
    const { updateFirmSettings } = await import("./settings");
    await updateFirmSettings(null, firmDetailsForm());

    const patch = updateCurrentFirmMock.mock.calls[0]![0];
    for (const key of Object.keys(patch)) {
      expect(["name", "brand_color", "locale_default"]).toContain(key);
    }
  });

  it("still writes auto_reject_unusable_docs if a form does send it", async () => {
    // The coercion is kept deliberately: .optional() drops an absent key but
    // a form that ships the checkbox still works.
    const { updateFirmSettings } = await import("./settings");
    const fd = firmDetailsForm();
    fd.set("auto_reject_unusable_docs", "on");
    await updateFirmSettings(null, fd);

    const patch = updateCurrentFirmMock.mock.calls[0]![0];
    expect(patch.auto_reject_unusable_docs).toBe(true);
  });

  it("refuses a non-owner before touching the firm", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-2", role: "staff" });
    const { updateFirmSettings } = await import("./settings");
    const result = await updateFirmSettings(null, firmDetailsForm());

    expect(result).toEqual({ error: "owner_only" });
    expect(updateCurrentFirmMock).not.toHaveBeenCalled();
  });
});
