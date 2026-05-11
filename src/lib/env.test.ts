import { describe, it, expect, beforeEach, vi } from "vitest";

describe("env validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws when required vars are missing", async () => {
    const prev = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      const { serverEnv } = await import("./env");
      expect(() => serverEnv()).toThrow(/Invalid server env/);
    } finally {
      if (prev.url) process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url;
      if (prev.key) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prev.key;
    }
  });

  it("accepts minimal valid env", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "a".repeat(40);
    const { serverEnv } = await import("./env");
    const env = serverEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  });
});
