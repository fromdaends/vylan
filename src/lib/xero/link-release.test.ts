import { describe, it, expect } from "vitest";
import { decideXeroLinkRelease } from "./link-release";

const TENANT = "org-demo-1";

function input(over: Partial<Parameters<typeof decideXeroLinkRelease>[0]> = {}) {
  return {
    connectionId: "conn-1",
    accessToken: "tok",
    tenantId: TENANT,
    tenantsStillInUse: new Set<string>(),
    ...over,
  };
}

describe("decideXeroLinkRelease", () => {
  it("releases when nobody else holds the org", () => {
    expect(decideXeroLinkRelease(input())).toEqual({
      release: true,
      connectionId: "conn-1",
      accessToken: "tok",
    });
  });

  // The reason 0950 needed this at all: a demo org backing a second client must
  // survive the first client disconnecting.
  it("keeps the link when another client still uses the org", () => {
    expect(
      decideXeroLinkRelease(
        input({ tenantsStillInUse: new Set([TENANT, "org-other"]) }),
      ),
    ).toEqual({ release: false, reason: "shared" });
  });

  it("ignores other orgs being in use", () => {
    expect(
      decideXeroLinkRelease(
        input({ tenantsStillInUse: new Set(["org-other"]) }),
      ),
    ).toEqual({ release: true, connectionId: "conn-1", accessToken: "tok" });
  });

  it("cannot release without a connection id", () => {
    expect(decideXeroLinkRelease(input({ connectionId: null }))).toEqual({
      release: false,
      reason: "no_link",
    });
  });

  it("cannot release without a live token", () => {
    expect(decideXeroLinkRelease(input({ accessToken: null }))).toEqual({
      release: false,
      reason: "no_token",
    });
  });

  // findXeroTenantIdsInUse fails CLOSED (a DB error reports every id as in use),
  // so a transient blip must leak the link, never sever a live connection.
  it("keeps the link when the in-use lookup failed closed", () => {
    expect(
      decideXeroLinkRelease(input({ tenantsStillInUse: new Set([TENANT]) })),
    ).toEqual({ release: false, reason: "shared" });
  });

  // A missing link/token is reported as such even when the org is also shared,
  // so the call-site log names the real reason nothing was released.
  it("reports the missing link ahead of sharing", () => {
    expect(
      decideXeroLinkRelease(
        input({ connectionId: null, tenantsStillInUse: new Set([TENANT]) }),
      ),
    ).toEqual({ release: false, reason: "no_link" });
  });
});
