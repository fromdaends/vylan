import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { assembleStatement } from "@/lib/invoices/statement-data";
import { renderStatementPdf } from "@/lib/invoices/statement-pdf";
import { statementFilename } from "@/lib/invoices/statement-model";
import { buildContentDisposition } from "@/lib/files/content-disposition";

// Statement of account for one client: every invoice in a date range, its
// status, and the total owing.
//
// Authorization is the same two-layer story as the invoice PDF route: the RLS
// read means a foreign client id resolves to nothing, and money.view gates the
// surface on top of that (assembleStatement also re-checks the firm).
//
// The date range comes from the Billing table's current filters, so the
// statement covers exactly what the accountant is looking at. Both bounds are
// optional — no range at all means "every invoice to date", which is the
// version a client usually wants.

export const runtime = "nodejs";
export const maxDuration = 30;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanDay(v: string | null): string | null {
  return v && ISO_DAY.test(v) ? v : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params;

  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(me, "money.view")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  let from = cleanDay(sp.get("from"));
  let to = cleanDay(sp.get("to"));
  // Same swap the list does: a backwards range would silently return nothing
  // and read as "this client has no invoices", which is a lie worth avoiding.
  if (from && to && from > to) [from, to] = [to, from];

  const model = await assembleStatement(clientId, { from, to });
  if (!model) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const pdf = await renderStatementPdf(model);
  // Statements default to DOWNLOAD rather than inline: this is a document the
  // firm sends on to a client, not something they read in a tab.
  const inline = sp.get("inline") === "1";
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": buildContentDisposition(
        statementFilename(model),
        !inline,
      ),
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
