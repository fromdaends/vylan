import { describe, it, expect } from "vitest";
import { SettingsSchema } from "./settings";

const BASE = {
  name: "Cabinet Test",
  brand_color: "#1e293b",
  timezone: "America/Toronto",
  locale_default: "fr",
};

describe("SettingsSchema — auto_reject_unusable_docs coercion", () => {
  it("defaults to false when the field is absent from the form", () => {
    const out = SettingsSchema.parse({ ...BASE });
    expect(out.auto_reject_unusable_docs).toBe(false);
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
