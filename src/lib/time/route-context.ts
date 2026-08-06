// The timer's ONE route read (timer v2 spec): which client or engagement the
// user is standing on, from the locale-stripped pathname. Plain module — the
// dock imports it, and its test must not have to drag a client component
// (and next-intl's navigation) into a node test environment.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /clients/[id] → that client; /engagements/[id] (except /new) → that
 *  engagement; anywhere else → nothing. */
export function parseRouteContext(pathname: string): {
  clientId: string | null;
  engagementId: string | null;
} {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "clients" && parts[1] && UUID_RE.test(parts[1])) {
    return { clientId: parts[1], engagementId: null };
  }
  if (parts[0] === "engagements" && parts[1] && UUID_RE.test(parts[1])) {
    return { clientId: null, engagementId: parts[1] };
  }
  return { clientId: null, engagementId: null };
}
