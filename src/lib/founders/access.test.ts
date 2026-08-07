import { afterEach, describe, expect, it } from "vitest";
import {
  founderAccessUnconfigured,
  founderEmails,
  isFounderEmail,
  parseFounderEmails,
} from "@/lib/founders/access";

const ORIGINAL = {
  FOUNDER_EMAILS: process.env.FOUNDER_EMAILS,
  FOUNDER_NOTIFY_EMAIL: process.env.FOUNDER_NOTIFY_EMAIL,
};

afterEach(() => {
  // Restore rather than delete: another suite in the same worker may depend on
  // whatever the environment actually had.
  if (ORIGINAL.FOUNDER_EMAILS === undefined) delete process.env.FOUNDER_EMAILS;
  else process.env.FOUNDER_EMAILS = ORIGINAL.FOUNDER_EMAILS;
  if (ORIGINAL.FOUNDER_NOTIFY_EMAIL === undefined) delete process.env.FOUNDER_NOTIFY_EMAIL;
  else process.env.FOUNDER_NOTIFY_EMAIL = ORIGINAL.FOUNDER_NOTIFY_EMAIL;
});

describe("parseFounderEmails", () => {
  it("splits on commas, semicolons, spaces and newlines", () => {
    expect(parseFounderEmails("a@x.com, b@y.com;c@z.com\nd@w.com e@v.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
      "d@w.com",
      "e@v.com",
    ]);
  });

  it("lowercases and trims", () => {
    expect(parseFounderEmails("  Zachary.Thresh@ICloud.com  ")).toEqual([
      "zachary.thresh@icloud.com",
    ]);
  });

  it("drops anything that is not email-shaped", () => {
    expect(parseFounderEmails("zach, , true, 1, a@b.com")).toEqual(["a@b.com"]);
  });

  it("treats a missing or non-string value as an empty list", () => {
    expect(parseFounderEmails(undefined)).toEqual([]);
    expect(parseFounderEmails(null)).toEqual([]);
    expect(parseFounderEmails("")).toEqual([]);
  });
});

describe("isFounderEmail", () => {
  it("matches case-insensitively, like the citext column it mirrors", () => {
    expect(isFounderEmail("ZACH@vylan.app", ["zach@vylan.app"])).toBe(true);
    expect(isFounderEmail("  zach@vylan.app ", ["zach@vylan.app"])).toBe(true);
  });

  it("refuses anyone not on the list", () => {
    expect(isFounderEmail("someone@else.com", ["zach@vylan.app"])).toBe(false);
  });

  // THE test. An unconfigured environment must lock the door, not open it.
  it("FAILS CLOSED on an empty allowlist", () => {
    expect(isFounderEmail("zach@vylan.app", [])).toBe(false);
    expect(isFounderEmail("anyone@anywhere.com", [])).toBe(false);
  });

  it("refuses a missing email", () => {
    expect(isFounderEmail(null, ["zach@vylan.app"])).toBe(false);
    expect(isFounderEmail(undefined, ["zach@vylan.app"])).toBe(false);
    expect(isFounderEmail("", ["zach@vylan.app"])).toBe(false);
  });
});

describe("founderEmails", () => {
  it("unions both env sources and de-duplicates", () => {
    process.env.FOUNDER_EMAILS = "zach@vylan.app, tyler@vylan.app";
    process.env.FOUNDER_NOTIFY_EMAIL = "ZACH@vylan.app";
    expect(founderEmails()).toEqual(["zach@vylan.app", "tyler@vylan.app"]);
  });

  it("works from the notify address alone, so the console is reachable on day one", () => {
    delete process.env.FOUNDER_EMAILS;
    process.env.FOUNDER_NOTIFY_EMAIL = "zach@vylan.app";
    expect(founderEmails()).toEqual(["zach@vylan.app"]);
    expect(founderAccessUnconfigured()).toBe(false);
  });

  it("is empty — and reports itself unconfigured — when neither var is set", () => {
    delete process.env.FOUNDER_EMAILS;
    delete process.env.FOUNDER_NOTIFY_EMAIL;
    expect(founderEmails()).toEqual([]);
    expect(founderAccessUnconfigured()).toBe(true);
    expect(isFounderEmail("zach@vylan.app")).toBe(false);
  });
});
