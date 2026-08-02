import { describe, it, expect } from "vitest";
import { firmAllowsMemberInvites } from "./firms";

// A security setting has to fail to the TIGHT side when it cannot read itself.
// This is the whole contract of the helper, and the reason no caller reads
// firm.invite_policy directly.
describe("firmAllowsMemberInvites", () => {
  it("opens up only for the exact string 'members'", () => {
    expect(firmAllowsMemberInvites({ invite_policy: "members" })).toBe(true);
  });

  it("keeps invites owner-only by default", () => {
    expect(firmAllowsMemberInvites({ invite_policy: "owner" })).toBe(false);
  });

  it("keeps invites owner-only before migration 1200 is applied", () => {
    // The column does not exist yet, so the row comes back without the key.
    expect(firmAllowsMemberInvites({})).toBe(false);
    expect(firmAllowsMemberInvites({ invite_policy: undefined })).toBe(false);
  });

  it("keeps invites owner-only when there is no firm at all", () => {
    expect(firmAllowsMemberInvites(null)).toBe(false);
    expect(firmAllowsMemberInvites(undefined)).toBe(false);
  });

  it("keeps invites owner-only for a value this build has never heard of", () => {
    // A future migration adding a third policy must not read as "open" to an
    // older deployment that is still running while it rolls out.
    expect(
      firmAllowsMemberInvites({
        invite_policy: "everyone" as unknown as "members",
      }),
    ).toBe(false);
  });
});
