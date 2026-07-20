import { NextResponse, type NextRequest } from "next/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getPaymentRequestById } from "@/lib/db/payment-requests";
import { getInvoicePdfSR } from "@/lib/invoices/pdf-data";
import { buildContentDisposition } from "@/lib/files/content-disposition";

// Accountant-side invoice PDF: view (inline) or download the generated
// document for one of the firm's own invoices. Authorization = the RLS read
// (a foreign id resolves to nothing) + an explicit firm check on top.

export const runtime = "nodejs";
export const maxDuration = 30;

const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const firm = await getCurrentFirm();
  if (!firm) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pr = await getPaymentRequestById(id);
  if (!pr || pr.firm_id !== firm.id || pr.invoice_kind !== "generated") {
    return notFound();
  }

  const result = await getInvoicePdfSR(pr);
  if (!result) return notFound();

  const asDownload = request.nextUrl.searchParams.get("download") === "1";
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
