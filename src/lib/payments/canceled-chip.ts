// How long the engagement header's "Payment canceled · $X" chip lingers after an
// invoice is waived/canceled before it hides itself. The cancellation stays
// permanently in the Activity feed + audit log; this chip is only a brief header
// confirmation so a waived invoice doesn't sit in the header forever.
// ~3 minutes ("a couple of minutes") — change this one line to retune it.
//
// WHY THIS LIVES IN A NEUTRAL MODULE (do not move it into the chip component):
// the chip component is "use client", and the SERVER page reads this value to
// decide whether to render the chip at all. A non-component value imported from
// a "use client" module into a Server Component does NOT arrive as the value —
// Next replaces it with a client-reference stub function. The comparison
// `elapsed < STUB` then silently evaluates to false forever, so the chip never
// renders. That exact bug shipped once; typecheck and unit tests both pass
// through it because it only manifests at the real server/client boundary.
export const PAYMENT_CANCELED_CHIP_WINDOW_MS = 3 * 60_000;
