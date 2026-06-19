import { z } from "zod";

// Treat empty strings (from blank .env entries) as unset.
const optionalSecret = (min = 10) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(min).optional(),
  );

const optionalEmail = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().email().optional(),
  );

const ServerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret(20),

  RESEND_API_KEY: optionalSecret(),
  RESEND_FROM_EMAIL: optionalEmail(),

  TWILIO_ACCOUNT_SID: optionalSecret(),
  TWILIO_AUTH_TOKEN: optionalSecret(),
  TWILIO_FROM_NUMBER: optionalSecret(8),

  ANTHROPIC_API_KEY: optionalSecret(),

  STRIPE_SECRET_KEY: optionalSecret(),
  STRIPE_WEBHOOK_SECRET: optionalSecret(),
  // Separate signing secret for the Connect webhook endpoint (account.updated +
  // client-payment events). Connect events carry a different secret than the
  // subscription webhook, so they must be verified independently.
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalSecret(),

  APP_URL: z.string().url().default("http://localhost:3000"),
  CRON_SECRET: optionalSecret(16),
});

const PublicEnvSchema = ServerEnvSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
  APP_URL: true,
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type PublicEnv = z.infer<typeof PublicEnvSchema>;

let _serverEnv: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (_serverEnv) return _serverEnv;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid server env:\n  ${issues}`);
  }
  _serverEnv = parsed.data;
  return _serverEnv;
}

export function publicEnv(): PublicEnv {
  return PublicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  });
}
