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
