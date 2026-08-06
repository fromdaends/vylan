// Reading an engagement's frozen proposal (migration 1660).
//
// THE CONTRACT, and it matters more here than anywhere else in the codebase:
// readProposalSnapshot is TOTAL. It is on the path that renders a page a CLIENT
// opens from an emailed link, with no session and no way to retry anything
// clever. A throw there is a blank screen at the exact moment a firm is asking
// somebody to agree to pay them.
//
// So: anything at all can be handed to it — null, a string, a payload written
// by a newer build — and it returns something a client can read.

import type { ProposalPreviewData } from "@/components/engagements/proposal-preview";
import { BILLING_FREQUENCIES as FREQUENCIES, type BillingFrequency } from "@/lib/engagements/items";
import { readTermsSections } from "@/lib/engagements/terms-sections";

function obj(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
/** Text the client SEES — kept only when it says something. */
function textOrNull(v: unknown): string | null {
  const s = str(v);
  return s.length > 0 ? s : null;
}
function cents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < 0 || v > 99_999_999) return null;
  return v;
}

/**
 * What the firm freezes onto the engagement when it sends the proposal.
 *
 * Deliberately the SAME shape ProposalPreview already takes, minus the client
 * name — which comes from the engagement's own client, not the snapshot, so a
 * renamed client still reads correctly on their own document.
 */
export type ProposalSnapshot = Omit<ProposalPreviewData, "clientName">;

export function readProposalSnapshot(
  raw: unknown,
  clientName: string,
): ProposalPreviewData {
  const o = obj(raw);
  return {
    clientName,
    engagementName: str(o?.engagementName),
    // Anything unrecognised reads as "begins on acceptance" — the safe answer,
    // and the one that is true of most work.
    periodStartsOn: o?.periodStartsOn === "custom" ? "custom" : "acceptance",
    periodMonths:
      typeof o?.periodMonths === "number" && Number.isInteger(o.periodMonths)
        ? o.periodMonths
        : null,
    welcome: textOrNull(o?.welcome),
    videoUrl: textOrNull(o?.videoUrl),
    documentName: textOrNull(o?.documentName),
    videoPath: textOrNull(o?.videoPath),
    documentPath: textOrNull(o?.documentPath),
    services: arr(o?.services)
      .map((x) => {
        const s = obj(x);
        if (!s) return null;
        const name = str(s.name);
        if (name.length === 0) return null;
        return {
          name,
          rateCents: cents(s.rateCents),
          // The work this line buys (1620). Strings only, trimmed, capped —
          // a snapshot from a newer build must not be able to put a hundred
          // lines of anything under one service on a client's contract.
          work: arr(s.work)
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter((x) => x.length > 0)
            .slice(0, 25),
          // Carried so the client's copy totals itself. An unrecognised value
          // reads as a one-off charge, which is the safe reading: it groups the
          // line on its own rather than folding it into someone else's cycle.
          billingFrequency: FREQUENCIES.includes(s.billingFrequency as BillingFrequency)
            ? (s.billingFrequency as BillingFrequency)
            : "once",
          taxPct:
            typeof s.taxPct === "number" && Number.isFinite(s.taxPct)
              ? s.taxPct
              : null,
        };
      })
      .filter((x) => x != null),
    terms: textOrNull(o?.terms),
    // Sections when the snapshot has them, otherwise the legacy string
    // upgraded into one untitled section — a contract already agreed to reads
    // exactly as it did the day it was signed.
    termsSections:
      readTermsSections(o?.termsSections).length > 0
        ? readTermsSections(o?.termsSections)
        : readTermsSections(o?.terms ?? null),
    // Absent reads as TRUE. A proposal whose signature block failed to read
    // should still ask the client to sign — the other default would present a
    // contract with no signature line and no explanation.
    clientSigns: o?.clientSigns !== false,
    additionalSignerLabels: arr(o?.additionalSignerLabels)
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .slice(0, 10),
    firmCountersigns: o?.firmCountersigns === true,
    depositCents: cents(o?.depositCents),
    // Absent means show everything: a proposal written before this existed
    // showed every figure, and it must keep doing exactly that. Only a literal
    // false hides one.
    priceVisibility: {
      itemizedPrice: obj(o?.priceVisibility)?.itemizedPrice !== false,
      blockTotals: obj(o?.priceVisibility)?.blockTotals !== false,
      total: obj(o?.priceVisibility)?.total !== false,
    },
  };
}

/**
 * Is there enough here to show a client?
 *
 * A proposal with no name, no services and no terms is a blank page with an
 * Accept button on it — worse than not asking. The portal falls back to its
 * normal view when this is false, which is the honest failure.
 */
export function proposalIsPresentable(p: ProposalPreviewData): boolean {
  return (
    p.engagementName.length > 0 ||
    p.services.length > 0 ||
    (p.termsSections?.length ?? 0) > 0
  );
}
