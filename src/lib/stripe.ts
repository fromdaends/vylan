import Stripe from "stripe";

let _client: Stripe | null = null;

export function stripe(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim() === "") return null;
  _client = new Stripe(key);
  return _client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

// Which Stripe MODE is this environment's secret key in? Standard (sk_) and
// restricted (rk_) keys both carry the mode in their prefix. Returns null if the
// key is missing or an unrecognised shape. Used to keep a firm's connected
// account (which is mode-specific) aligned with the key that will operate it —
// a live key cannot touch a test-mode account, and vice versa.
export function stripeKeyMode(): "test" | "live" | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}
