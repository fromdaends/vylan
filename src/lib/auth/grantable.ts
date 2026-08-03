import type { Capability } from "./capabilities";

// Which capabilities may be handed out — to a PERSON (their own switches) or to
// a ROLE (everyone who wears it).
//
// ONE LIST, TWO CONSUMERS, and that is the whole reason this file exists. It
// lived as a const inside member-permissions.tsx until roles needed the same
// set; copied, the two would drift, and the drift would be silent — a
// capability grantable through a role but not a person, or the reverse, with
// nothing to catch it.
//
// The reasoning below is the per-person reasoning, unchanged, because a role is
// just a way of granting the same thing to several people at once. Nothing is
// safe to grant via a role that is unsafe to grant to a person.
//
// DELIBERATELY NOT GRANTABLE, and each for its own reason:
//
//   team.manage      — every write in app/actions/team.ts uses the service-role
//                      client, so the inline check is the only gate there is;
//                      and firm_invites' select policy was owner-only until
//                      1200, so a granted non-owner got a management screen
//                      with a permanently empty invite list.
//   clients.private  — decided by RLS (0810). Granting it in application code
//                      would change what the UI renders and nothing about what
//                      the database returns. A switch that does not work is
//                      worse than no switch.
//   audit.view       — the founder's call, twice: history is owner-only.
//   firm.settings    — firm-wide policy. Not per-person by nature; if a firm
//                      wants it delegated, that is a co-owner, not a switch.
//   clients.manage   — carried by the member preset already, so granting it
//                      would only ever matter for a Junior, and taking clients
//                      away from a Junior is the point of the preset.
//   money.view       — same: the preset decides it, and a role that put money
//                      back would make "Junior" mean two different things
//                      depending on what else the person wears.
//   time.approve     — Phase 8. The capability exists; the feature does not.
export const GRANTABLE_CAPABILITIES: readonly Capability[] = [
  "billing.manage",
  "integrations.manage",
];

export function isGrantable(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    (GRANTABLE_CAPABILITIES as readonly string[]).includes(value)
  );
}
