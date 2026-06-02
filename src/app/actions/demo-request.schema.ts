// Zod schemas for the three steps of the public demo form.
// Lives in its own file (not next to the server action) so client
// components can import it for client-side validation without
// dragging a "use server" module into the bundle.

import { z } from "zod";

// Canadian provinces + territories (for Step 3 dropdown).
export const PROVINCES = [
  "QC",
  "ON",
  "BC",
  "AB",
  "MB",
  "SK",
  "NS",
  "NB",
  "NL",
  "PE",
  "YT",
  "NT",
  "NU",
] as const;
export type Province = (typeof PROVINCES)[number];

export const FIRM_SIZES = ["solo", "2_5", "6_15", "16_plus"] as const;
export const CLIENT_VOLUMES = [
  "under_25",
  "25_100",
  "100_300",
  "300_plus",
] as const;
export const CURRENT_TOOLS = [
  "manual_email",
  "taxdome",
  "karbon",
  "other_software",
  "nothing",
] as const;

// Step 1 — who you are.
export const DemoStep1Schema = z.object({
  contact_name: z.string().trim().min(2, "name_too_short").max(120, "too_long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("invalid_email")
    .max(254, "too_long"),
  firm_name: z.string().trim().min(2, "firm_too_short").max(160, "too_long"),
});
export type DemoStep1Input = z.infer<typeof DemoStep1Schema>;

// Step 2 — qualifying. Cross-field rule: if the tool is
// "other_software", current_tool_other is required.
export const DemoStep2Schema = z
  .object({
    firm_size: z.enum(FIRM_SIZES),
    client_volume: z.enum(CLIENT_VOLUMES),
    current_tool: z.enum(CURRENT_TOOLS),
    current_tool_other: z
      .string()
      .trim()
      .max(120, "too_long")
      .optional()
      .or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.current_tool === "other_software") {
      if (!val.current_tool_other || val.current_tool_other.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["current_tool_other"],
          message: "tool_name_required",
        });
      }
    }
  });
export type DemoStep2Input = z.infer<typeof DemoStep2Schema>;

// Step 3 — contact + scheduling. Phone is optional, opt-in must be
// an explicit boolean (CASL). preferred_language defaults to "fr"
// in the form but we still accept either.
export const DemoStep3Schema = z.object({
  phone: z
    .string()
    .trim()
    .max(40, "too_long")
    .optional()
    .or(z.literal("")),
  province: z.enum(PROVINCES),
  preferred_language: z.enum(["fr", "en"]),
  marketing_opt_in: z.boolean(),
});
export type DemoStep3Input = z.infer<typeof DemoStep3Schema>;

// ---------------------------------------------------------------------------
// Landing marketing-site "Tell us about your firm" form.
//
// A single submit (not the 3-step /demo flow), but it writes to the same
// demo_requests table. Values are stable keys (NOT the visible labels) so
// validation + stored data are identical across EN/FR — the form renders a
// translated label per option but submits the key.
// ---------------------------------------------------------------------------
export const PRACTICE_TYPES = [
  "solo",
  "small_firm",
  "mid_size",
  "tax_advisory",
  "other",
] as const;
export type PracticeType = (typeof PRACTICE_TYPES)[number];

export const ACTIVE_CLIENT_BUCKETS = [
  "under_25",
  "25_100",
  "100_500",
  "500_plus",
] as const;
export type ActiveClientBucket = (typeof ACTIVE_CLIENT_BUCKETS)[number];

export const FirmLeadSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("invalid_email")
    .max(254, "too_long"),
  firm_name: z.string().trim().min(2, "firm_too_short").max(160, "too_long"),
  practice_type: z.enum(PRACTICE_TYPES),
  active_clients: z.enum(ACTIVE_CLIENT_BUCKETS),
  notes: z.string().trim().max(2000, "too_long").optional().or(z.literal("")),
});
export type FirmLeadInput = z.infer<typeof FirmLeadSchema>;
