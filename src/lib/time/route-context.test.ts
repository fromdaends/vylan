import { describe, it, expect } from "vitest";
import { parseRouteContext } from "@/lib/time/route-context";

// The prefill contract (timer v2 spec): a client page prefills that client, an
// engagement page prefills that engagement, anywhere else prefills nothing.
describe("parseRouteContext", () => {
  const CID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

  it("reads a client profile", () => {
    expect(parseRouteContext(`/clients/${CID}`)).toEqual({
      clientId: CID,
      engagementId: null,
    });
  });

  it("reads an engagement page (sub-routes included)", () => {
    expect(parseRouteContext(`/engagements/${CID}`)).toEqual({
      clientId: null,
      engagementId: CID,
    });
    expect(parseRouteContext(`/engagements/${CID}/anything`)).toEqual({
      clientId: null,
      engagementId: CID,
    });
  });

  it("does NOT mistake /engagements/new or list pages for context", () => {
    expect(parseRouteContext("/engagements/new")).toEqual({
      clientId: null,
      engagementId: null,
    });
    expect(parseRouteContext("/engagements")).toEqual({
      clientId: null,
      engagementId: null,
    });
    expect(parseRouteContext("/clients")).toEqual({
      clientId: null,
      engagementId: null,
    });
  });

  it("reads nothing anywhere else", () => {
    expect(parseRouteContext("/dashboard")).toEqual({
      clientId: null,
      engagementId: null,
    });
    expect(parseRouteContext("/work/time")).toEqual({
      clientId: null,
      engagementId: null,
    });
  });
});
