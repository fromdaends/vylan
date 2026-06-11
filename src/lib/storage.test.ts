import { describe, it, expect } from "vitest";
import {
  isAllowedMime,
  isHeic,
  storagePath,
  MAX_BYTES,
} from "./storage";

describe("storage helpers", () => {
  it("MAX_BYTES is exactly 25 MB", () => {
    expect(MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  it("isAllowedMime accepts the documented MIMEs", () => {
    expect(isAllowedMime("application/pdf")).toBe(true);
    expect(isAllowedMime("image/jpeg")).toBe(true);
    expect(isAllowedMime("image/png")).toBe(true);
    expect(isAllowedMime("image/heic")).toBe(true);
    expect(isAllowedMime("image/heif")).toBe(true);
    expect(isAllowedMime("image/webp")).toBe(true);
  });

  it("isAllowedMime rejects executables and arbitrary types", () => {
    expect(isAllowedMime("application/octet-stream")).toBe(false);
    expect(isAllowedMime("text/html")).toBe(false);
    expect(isAllowedMime("image/svg+xml")).toBe(false);
  });

  it("isHeic identifies HEIC and HEIF variants", () => {
    expect(isHeic("image/heic")).toBe(true);
    expect(isHeic("image/heif")).toBe(true);
    expect(isHeic("image/HEIC")).toBe(true);
    expect(isHeic("image/jpeg")).toBe(false);
  });

  it("storagePath builds the documented path layout", () => {
    const path = storagePath({
      firmId: "F",
      engagementId: "E",
      itemId: "I",
      uuid: "abc12345",
      filename: "T4 slip.pdf",
    });
    expect(path).toBe("firms/F/engagements/E/items/I/abc12345-T4_slip.pdf");
  });

  it("storagePath sanitizes slashes in user filenames", () => {
    const path = storagePath({
      firmId: "F",
      engagementId: "E",
      itemId: "I",
      uuid: "u",
      filename: "../../etc/passwd",
    });
    expect(path).not.toContain("../");
    // safeStorageName neutralizes the traversal entirely: slashes become
    // underscores and the leading dot-runs are trimmed away.
    expect(path.endsWith("u-etc_passwd")).toBe(true);
  });

  it("storagePath strips accents so the key stays inside Supabase's charset", () => {
    const path = storagePath({
      firmId: "F",
      engagementId: "E",
      itemId: "I",
      uuid: "u",
      filename: "Régie de l'assurance maladie.jpeg",
    });
    expect(path.endsWith("u-Regie_de_l_assurance_maladie.jpeg")).toBe(true);
  });
});
