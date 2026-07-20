import { NextResponse, type NextRequest } from "next/server";
import { isValidTokenShape } from "@/lib/db/portal";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getPaymentRequestByIdSR } from "@/lib/db/payment-requests";
import { getInvoicePdfSR } from "@/lib/invoices/pdf-data";
import { buildContentDisposition } from "@/lib/files/content-disposition";
import {
  checkRateLimit,
  ipFromRequest,
  PORTAL_FILE_VIEW_PER_TOKEN,
  PORTAL_FILE_VIEW_PER_IP,
} from "@/lib/rate-limit";

// Client-side invoice PDF through the magic-link portal: the generated
// document for THIS engagement's invoice. Same trust model as the sibling
// attached-invoice route: token shape + rate limits + token→engagement
// resolution, and the request must belong to that engagement. Deliberately
// independent of the deliverables lock — clients must always be able to read
// the bill they're being asked to pay.

export const runtime = "nodejs";
export const maxDuration = 30;

const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

function tooMany(retryAfter?: number) {
  const response = NextResponse.json(
    { error: "rate_limited" },
    { status: 429 },
  );
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const asDownload = request.nextUrl.searchParams.get("download") === "1";
  if (!isValidTokenShape(token)) return notFound();

  const [tokenLimit, ipLimit] = await Promise.all([
    checkRateLimit({
      key: `portal:invoice-pdf:token:${token}`,
      ...PORTAL_FILE_VIEW_PER_TOKEN,
    }),
    checkRateLimit({
      key: `portal:invoice-pdf:ip:${ipFromRequest(request)}`,
      ...PORTAL_FILE_VIEW_PER_IP,
    }),
  ]);
  if (!tokenLimit.ok) return tooMany(tokenLimit.retryAfter);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfter);

  const sb = getServiceRoleSupabase();
  const [{ data: engagement }, pr] = await Promise.all([
    sb
      .from("engagements")
      .select("id, status, magic_expires_at")
      .eq("magic_token", token)
      .maybeSingle(),
    getPaymentRequestByIdSR(id),
  ]);
  const expired =
    engagement?.magic_expires_at &&
    new Date(engagement.magic_expires_at as string).getTime() <= Date.now();
  if (
    !engagement ||
    engagement.status === "cancelled" ||
    expired ||
    !pr ||
    pr.engagement_id !== engagement.id ||
    pr.invoice_kind !== "generated" ||
    pr.status === "canceled"
  ) {
    return notFound();
  }

  const result = await getInvoicePdfSR(pr);
  if (!result) return notFound();

  return new Response(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": buildContentDisposition(
        result.filename,
        asDownload,
      ),
      "Content-Length": String(result.pdf.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
