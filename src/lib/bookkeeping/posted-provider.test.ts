import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/xero", () => ({ isClientXeroConnected: vi.fn() }));

import {
  providerForRetraction,
  resolveRetractionProvider,
} from "./posted-provider";
import { isClientXeroConnected } from "@/lib/db/xero";

const mockXeroConnected = vi.mocked(isClientXeroConnected);

describe("providerForRetraction", () => {
  // THE BUG. Both of these used to resolve from the client's CURRENT connection,
  // so a provider switch after posting sent the retraction to the wrong API — the
  // call failed, the draft stayed 'posted', and the entry stayed in real books
  // with no way back from inside Vylan.
  it("retracts in QuickBooks for a QuickBooks post even once Xero is connected", () => {
    expect(
      providerForRetraction({
        postedProvider: "quickbooks",
        isXeroConnectedNow: true,
      }),
    ).toBe("quickbooks");
  });

  it("retracts in Xero for a Xero post even once Xero is disconnected", () => {
    expect(
      providerForRetraction({
        postedProvider: "xero",
        isXeroConnectedNow: false,
      }),
    ).toBe("xero");
  });

  // Pre-1040 rows have nothing recorded. Falling back to the old behaviour is
  // deliberate: wrong only where it was already wrong, never newly wrong.
  it("falls back to the live connection when nothing was recorded", () => {
    expect(
      providerForRetraction({ postedProvider: null, isXeroConnectedNow: true }),
    ).toBe("xero");
    expect(
      providerForRetraction({ postedProvider: null, isXeroConnectedNow: false }),
    ).toBe("quickbooks");
  });
});

describe("resolveRetractionProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not query the connection when the provider was recorded", async () => {
    const r = await resolveRetractionProvider({
      postedProvider: "quickbooks",
      firmId: "firm-1",
      clientId: "client-1",
    });

    expect(r).toBe("quickbooks");
    // A recorded provider is authoritative, so the read is pure waste.
    expect(mockXeroConnected).not.toHaveBeenCalled();
  });

  it("queries the connection only for an unrecorded (pre-1040) row", async () => {
    mockXeroConnected.mockResolvedValue(true);

    const r = await resolveRetractionProvider({
      postedProvider: null,
      firmId: "firm-1",
      clientId: "client-1",
    });

    expect(r).toBe("xero");
    expect(mockXeroConnected).toHaveBeenCalledWith("firm-1", "client-1");
  });
});
