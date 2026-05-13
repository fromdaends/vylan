import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// Module mocks — set up before importing the SUT.
type UploadObjectOpts = {
  path: string;
  body: Buffer | ArrayBuffer | Uint8Array;
  contentType: string;
};
const uploadObjectMock = vi.fn<(opts: UploadObjectOpts) => Promise<undefined>>(
  async () => undefined,
);
const getBrandingImageUrlMock = vi.fn(
  async (path: string | null) => (path ? `https://signed/${path}` : null),
);
const getServerSupabaseMock = vi.fn(async () => ({
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: "user-1", email: "a@b.com" } },
    })),
  },
}));
const getCurrentFirmMock = vi.fn(async () => ({ id: "firm-1" }));
const getCurrentUserMock = vi.fn(async () => ({ id: "user-1" }));

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: () => getServerSupabaseMock(),
  getServiceRoleSupabase: () => ({}),
}));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirmMock() }));
vi.mock("@/lib/db/users", () => ({ getCurrentUser: () => getCurrentUserMock() }));

vi.mock("@/lib/storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    uploadObject: (opts: Parameters<typeof actual.uploadObject>[0]) =>
      uploadObjectMock(opts),
    getBrandingImageUrl: (path: string | null) =>
      getBrandingImageUrlMock(path),
  };
});

import { uploadBrandingImage } from "./branding";

async function makeFile(opts: {
  mime?: string;
  size?: number;
  format?: "png" | "jpeg";
}): Promise<File> {
  const buf = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  })
    [opts.format === "jpeg" ? "jpeg" : "png"]()
    .toBuffer();
  const padded =
    opts.size && opts.size > buf.length
      ? Buffer.concat([buf, Buffer.alloc(opts.size - buf.length)])
      : buf;
  return new File([new Uint8Array(padded)], "input." + (opts.format ?? "png"), {
    type: opts.mime ?? "image/png",
  });
}

function fd(file: File): FormData {
  const f = new FormData();
  f.append("file", file);
  return f;
}

describe("uploadBrandingImage", () => {
  beforeEach(() => {
    uploadObjectMock.mockClear();
    getBrandingImageUrlMock.mockClear();
    getServerSupabaseMock.mockClear();
    getCurrentFirmMock.mockClear();
    getCurrentUserMock.mockClear();
    // restore default return values
    getServerSupabaseMock.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email: "a@b.com" } },
        })),
      },
    } as never);
    getCurrentFirmMock.mockResolvedValue({ id: "firm-1" } as never);
    getCurrentUserMock.mockResolvedValue({ id: "user-1" } as never);
  });

  it("uploads a firm_logo and returns a signed URL", async () => {
    const file = await makeFile({});
    const res = await uploadBrandingImage(fd(file), "firm_logo");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toMatch(/^firms\/firm-1\/branding\/logo-[A-Za-z0-9_-]{12}\.jpg$/);
    expect(res.signedUrl).toContain("https://signed/");
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);
    expect(uploadObjectMock.mock.calls[0]?.[0]?.contentType).toBe("image/jpeg");
  });

  it("uploads a user_avatar with the user_id in the path", async () => {
    const file = await makeFile({});
    const res = await uploadBrandingImage(fd(file), "user_avatar");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toMatch(
      /^firms\/firm-1\/users\/user-1\/avatar-[A-Za-z0-9_-]{12}\.jpg$/,
    );
  });

  it("rejects when not signed in", async () => {
    getServerSupabaseMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    } as never);
    const file = await makeFile({});
    const res = await uploadBrandingImage(fd(file), "firm_logo");
    expect(res).toEqual({ ok: false, error: "unauth" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects when user has no firm", async () => {
    getCurrentFirmMock.mockResolvedValueOnce(null as never);
    const file = await makeFile({});
    const res = await uploadBrandingImage(fd(file), "firm_logo");
    expect(res).toEqual({ ok: false, error: "no_firm" });
  });

  it("rejects when file is missing", async () => {
    const res = await uploadBrandingImage(new FormData(), "firm_logo");
    expect(res).toEqual({ ok: false, error: "missing_file" });
  });

  it("rejects oversized file before processing", async () => {
    const big = await makeFile({ size: 21 * 1024 * 1024 });
    const res = await uploadBrandingImage(fd(big), "firm_logo");
    expect(res).toEqual({ ok: false, error: "too_large" });
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects bad mime", async () => {
    const file = new File([new Uint8Array(Buffer.from("GIF89a"))], "x.gif", {
      type: "image/gif",
    });
    const res = await uploadBrandingImage(fd(file), "firm_logo");
    expect(res).toEqual({ ok: false, error: "bad_mime" });
  });

  it("rejects bad kind", async () => {
    const file = await makeFile({});
    const res = await uploadBrandingImage(
      fd(file),
      // @ts-expect-error — intentionally bad input
      "shenanigans",
    );
    expect(res).toEqual({ ok: false, error: "bad_kind" });
  });

  it("returns process_failed when sharp can't decode", async () => {
    const bad = new File([new Uint8Array(Buffer.from("not real png bytes"))], "x.png", {
      type: "image/png",
    });
    const res = await uploadBrandingImage(fd(bad), "firm_logo");
    expect(res).toEqual({ ok: false, error: "process_failed" });
  });

  it("returns upload_failed when storage write throws", async () => {
    uploadObjectMock.mockRejectedValueOnce(new Error("storage exploded"));
    const file = await makeFile({});
    const res = await uploadBrandingImage(fd(file), "firm_logo");
    expect(res).toEqual({ ok: false, error: "upload_failed" });
  });
});
