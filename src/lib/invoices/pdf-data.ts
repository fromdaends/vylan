// Server-side assembly + freeze for generated-invoice PDFs. AUTHORIZATION IS
// THE CALLER'S JOB: the accountant route fetches the request through RLS, the
// portal route resolves it through the magic token, the freeze hook runs off a
// paid event — by the time a request row reaches these helpers it is already
// legitimate, so everything here reads via the service role for one consistent
// data path.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { downloadObject, uploadObject } from "@/lib/storage";
import {
  getPaymentRequestByIdSR,
  type PaymentRequest,
} from "@/lib/db/payment-requests";
import { getFirmInvoiceSettingsSR } from "@/lib/db/invoice-settings";
import {
  buildInvoicePdfModel,
  generatedInvoicePdfPath,
  invoicePdfFilename,
  type InvoicePdfModel,
} from "./pdf-model";
import { renderInvoicePdf } from "./pdf";

// Branding logos are processed to JPEG at upload; older objects may be PNG.
function logoMime(path: string): string {
  return path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

export type AssembledInvoicePdf = {
  model: InvoicePdfModel;
  filename: string;
};

// Load everything the document needs. Fail-soft on decorations (logo, client,
// engagement — a missing one renders a plainer document), null only when the
// request isn't a generated invoice or the firm row is gone.
export async function assembleInvoicePdfSR(
  request: PaymentRequest,
): Promise<AssembledInvoicePdf | null> {
  if (request.invoice_kind !== "generated") return null;
  const sb = getServiceRoleSupabase();

  const [{ data: firm }, settings] = await Promise.all([
    sb
      .from("firms")
      .select("name, brand_color, logo_url")
      .eq("id", request.firm_id)
      .maybeSingle(),
    getFirmInvoiceSettingsSR(request.firm_id),
  ]);
  if (!firm) return null;

  const [clientRes, engagementRes] = await Promise.all([
    request.client_id
      ? sb
          .from("clients")
          .select("display_name")
          .eq("id", request.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.engagement_id
      ? sb
          .from("engagements")
          .select("title")
          .eq("id", request.engagement_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let logoDataUri: string | null = null;
  const logoPath = firm.logo_url as string | null;
  if (logoPath) {
    try {
      const bytes = await downloadObject(logoPath);
      logoDataUri = `data:${logoMime(logoPath)};base64,${bytes.toString("base64")}`;
    } catch {
      // Old URL-shaped values / missing objects → name-only header.
      logoDataUri = null;
    }
  }

  const model = buildInvoicePdfModel({
    request,
    firm: {
      name: firm.name as string,
      brand_color: (firm.brand_color as string | null) ?? null,
    },
    settings,
    clientName:
      (clientRes.data?.display_name as string | undefined) ?? null,
    engagementTitle: (engagementRes.data?.title as string | undefined) ?? null,
    logoDataUri,
  });
  return { model, filename: invoicePdfFilename(model) };
}

// The PDF bytes for an (authorized) generated invoice. Paid invoices serve the
// copy frozen at the paid flip when one exists — the permanent record survives
// later firm-identity changes; everything else renders fresh from the row.
export async function getInvoicePdfSR(
  request: PaymentRequest,
): Promise<{ pdf: Buffer; filename: string } | null> {
  const assembled = await assembleInvoicePdfSR(request);
  if (!assembled) return null;
  if (request.status === "paid" && request.engagement_id) {
    try {
      const frozen = await downloadObject(
        generatedInvoicePdfPath({
          firmId: request.firm_id,
          engagementId: request.engagement_id,
          paymentRequestId: request.id,
        }),
      );
      return { pdf: frozen, filename: assembled.filename };
    } catch {
      // No frozen copy (paid before this feature, or the freeze failed) —
      // fall through to a fresh render; the row is immutable once paid, so
      // the output is the same document.
    }
  }
  const pdf = await renderInvoicePdf(assembled.model);
  return { pdf, filename: assembled.filename };
}

// Freeze the document at the paid flip (called from recordInvoicePaid,
// best-effort). Upsert: replays overwrite with identical bytes.
export async function freezeInvoicePdfSR(
  paymentRequestId: string,
): Promise<void> {
  try {
    const request = await getPaymentRequestByIdSR(paymentRequestId);
    if (
      !request ||
      request.invoice_kind !== "generated" ||
      !request.engagement_id
    ) {
      return;
    }
    const assembled = await assembleInvoicePdfSR(request);
    if (!assembled) return;
    const pdf = await renderInvoicePdf(assembled.model);
    await uploadObject({
      path: generatedInvoicePdfPath({
        firmId: request.firm_id,
        engagementId: request.engagement_id,
        paymentRequestId: request.id,
      }),
      body: pdf,
      contentType: "application/pdf",
      upsert: true,
    });
  } catch (e) {
    // Never let the freeze fail the payment path — on-demand rendering of the
    // now-immutable row produces the same document anyway.
    console.error("[invoices] freezeInvoicePdfSR failed:", e);
  }
}
