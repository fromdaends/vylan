// When an accepted proposal actually becomes live work.
//
// ── THE FOUNDER'S FLOW ─────────────────────────────────────────────────────
//
// "they read the whole proposal and stuff then agree then pay and once they pay
// the client portal activates for the client and bobs your uncle."
//
// So there are now THREE moments where there used to be one:
//
//   1. sent      — the client has the link and has read nothing
//   2. accepted  — they agreed. The agreement is recorded and cannot be lost.
//   3. active    — the deposit cleared. The portal opens, the work starts.
//
// acceptProposalAction used to do all of 2 and 3 in a single write, which was
// right when nothing stood between agreeing and starting. A deposit does.
//
// ── WHY THE AGREEMENT IS RECORDED BEFORE THE MONEY ─────────────────────────
//
// The founder chose "payment completes the agreement" over "accept, then pay",
// and this module honours that — the portal stays shut until the deposit
// clears. But the ACCEPTANCE is still written the instant they click, because
// the alternative loses it: a client who agrees and then has a card declined
// would leave the firm with no record that anyone ever said yes.
//
// So the state is "accepted, awaiting deposit" — visible to the firm, exitable
// by the client (the payment screen is right there), and never a dead end.
//
// ── PURE, SO THE RULE IS PROVABLE ──────────────────────────────────────────
//
// The decision is here with no I/O; the writing lives in the actions that own
// their own database access. Two callers ask this question — the client's own
// accept, and the firm recording an acceptance on their behalf — and they must
// never answer it differently.

export type ActivationFacts = {
  /**
   * Money the client owes AT ACCEPTANCE and has not paid — in cents.
   *
   * ⚠️ THIS USED TO BE THE DEPOSIT ONLY, and that was too narrow. The founder
   * accepted a $459.90 engagement billed 'on_acceptance' with no deposit set,
   * and walked straight into the portal without paying: "you just click accept
   * and it brings you to the portal. Even though the engagement was supposed to
   * be five hundred dollars."
   *
   * A deposit and an on-acceptance invoice are the same promise from the
   * client's side — money due before the work starts — so the gate counts BOTH.
   * Null/0 means nothing is owed yet.
   */
  dueNowCents: number | null;
  /**
   * Can the firm actually take the money right now?
   *
   * Money nobody can pay must NOT hold the portal shut. A firm that has not
   * finished connecting Stripe would otherwise trap every client who accepts in
   * a state with no way out and no way to pay — the engagement would look
   * agreed-to and dead at the same time.
   */
  canCollectPayment: boolean;
};

/**
 * Does accepting start the work immediately, or wait for the deposit?
 *
 * TRUE for the ordinary case (no deposit), which is most engagements, so the
 * behaviour clients and firms already know is unchanged unless money is
 * genuinely being asked for up front.
 */
export function acceptanceActivatesImmediately(f: ActivationFacts): boolean {
  // Nothing outstanding — either none was owed, or it is already settled.
  if (f.dueNowCents == null || f.dueNowCents <= 0) return true;
  // Money that cannot be collected cannot be a gate.
  return !f.canCollectPayment;
}

/**
 * Is this engagement agreed-to but still waiting on its deposit?
 *
 * The portal's third state. Deliberately requires an acceptance to exist: an
 * unaccepted proposal shows the proposal, never a payment screen, because
 * asking someone to pay for something they have not agreed to is the wrong
 * order and the founder corrected exactly that ordering once already.
 */
export function isAwaitingPayment(
  f: ActivationFacts & { acceptedAt: string | null | undefined },
): boolean {
  if (f.acceptedAt == null) return false;
  return !acceptanceActivatesImmediately(f);
}

/**
 * What the final invoice should bill once a deposit has been paid.
 *
 * The founder, asked directly whether a $1,000 deposit on a $5,000 engagement
 * leaves a $4,000 or a $5,000 final invoice: "The balance obviously."
 *
 * So the deposit is CREDITED, not additive. Without this the client is billed
 * $6,000 for a $5,000 job — two invoices raised the same day by two code paths
 * neither of which knew about the other.
 *
 * Never returns a negative: a deposit larger than the engagement total (a
 * typo, or a scope that shrank after acceptance) leaves nothing to bill rather
 * than an invoice for minus money, which no rail can charge and no client can
 * read. It returns 0, and the caller declines to raise an invoice at all.
 */
export function invoiceAfterDeposit(
  invoiceCents: number,
  depositPaidCents: number,
): number {
  if (!Number.isFinite(invoiceCents) || invoiceCents <= 0) return 0;
  if (!Number.isFinite(depositPaidCents) || depositPaidCents <= 0) {
    return invoiceCents;
  }
  return Math.max(0, invoiceCents - Math.round(depositPaidCents));
}
