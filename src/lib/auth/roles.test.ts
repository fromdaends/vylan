import { describe, it, expect } from "vitest";
import { roleSatisfies, RoleError } from "./roles";

describe("roleSatisfies", () => {
  it("owner satisfies an owner requirement", () => {
    expect(roleSatisfies("owner", "owner")).toBe(true);
  });

  it("staff does NOT satisfy an owner requirement", () => {
    expect(roleSatisfies("staff", "owner")).toBe(false);
  });

  it("a signed-out user (null / undefined) satisfies nothing", () => {
    expect(roleSatisfies(null, "owner")).toBe(false);
    expect(roleSatisfies(undefined, "owner")).toBe(false);
    expect(roleSatisfies(null, "staff")).toBe(false);
  });

  it("any signed-in member satisfies a staff requirement", () => {
    expect(roleSatisfies("owner", "staff")).toBe(true);
    expect(roleSatisfies("staff", "staff")).toBe(true);
  });
});

describe("RoleError", () => {
  it("carries the required role and a stable name", () => {
    const e = new RoleError("owner");
    expect(e.required).toBe("owner");
    expect(e.name).toBe("RoleError");
    expect(e).toBeInstanceOf(Error);
  });
});
