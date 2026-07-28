// Xero org-link release — the one decision, in one pure place.
//
// Xero models our app's access to an organisation as a SINGLE shared connection
// object per (Xero user, org). DELETE /connections/{id} releases it for
// everybody, so before releasing one we must know whether any OTHER stored
// client row still depends on that org.
//
// This mattered less before 0950, when a plain unique index on tenant_id meant
// exactly one client row could ever reference an org. That index is now PARTIAL
// (`where is_demo = false`), so Xero's Demo Company can back several clients at
// once and "am I the last one out?" became a real question — asked in three
// places: this client's disconnect, the callback's tenant-SWITCH release, and
// the import flow's release of a link it only borrowed.
//
// Pure so the rule is unit-tested once instead of re-argued at each call site.

export type XeroLinkReleaseInput = {
  // Xero's id for the app↔org link. Absent = nothing to release remotely (an
  // older row, or a connect that could not read it); clear locally and move on.
  connectionId: string | null;
  // A live access token — the connections endpoint is Bearer-authed. Null when
  // the connection is dead/unrefreshable, which is not worth failing over: the
  // local row still goes, the link just lingers at Xero.
  accessToken: string | null;
  tenantId: string;
  // Orgs that STILL have a stored connection row, from findXeroTenantIdsInUse.
  //
  // CALLER CONTRACT — this set must be computed so it does NOT include the row
  // being released. The disconnect route achieves that by deleting its row
  // first; the callback's switch path by overwriting the row's tenant before
  // asking. Ask while your own row still points at the org and the answer is
  // always "in use", so the link is never released and every free-tier slot
  // leaks. findXeroTenantIdsInUse is also cross-firm on purpose: another FIRM's
  // client on the same demo org must not be severed either.
  tenantsStillInUse: ReadonlySet<string>;
};

// Carries the link + token on the release branch so the caller destructures
// non-null values instead of re-asserting what this function already checked.
export type XeroLinkReleaseDecision =
  | { release: true; connectionId: string; accessToken: string }
  // "shared": someone else still needs this org — leave the link alone.
  // "no_link" / "no_token": nothing we can do remotely; local cleanup only.
  | { release: false; reason: "shared" | "no_link" | "no_token" };

export function decideXeroLinkRelease(
  input: XeroLinkReleaseInput,
): XeroLinkReleaseDecision {
  if (!input.connectionId) return { release: false, reason: "no_link" };
  if (!input.accessToken) return { release: false, reason: "no_token" };
  // Checked LAST so "shared" always means a genuine live dependency rather than
  // shadowing a missing link/token — the log line at the call site says which.
  if (input.tenantsStillInUse.has(input.tenantId)) {
    return { release: false, reason: "shared" };
  }
  return {
    release: true,
    connectionId: input.connectionId,
    accessToken: input.accessToken,
  };
}
