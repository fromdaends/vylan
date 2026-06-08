import { NextResponse, type NextRequest } from "next/server";
import { sendEmail, resolveSender } from "@/lib/email";

// TEMPORARY production email diagnostic. Remove once the "no confirmation
// email" issue is resolved. Token-guarded so only we can trigger it, and it
// sends to Resend's built-in sink address (delivered@resend.dev) so no real
// inbox is touched. Reports whether the Resend key is actually present in the
// prod runtime, the From we'd use, whether APP_URL is set (affects the confirm
// link), and exactly what Resend returns on a send.
const PROBE_TOKEN = "vylan-email-probe-7t3kq9";

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get("token") !== PROBE_TOKEN) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const keyPresent = !!process.env.RESEND_API_KEY?.trim();
  const fromEmail = resolveSender(process.env.RESEND_FROM_EMAIL);
  const appUrl = process.env.APP_URL ?? null;

  let sendProbe: unknown;
  try {
    sendProbe = await sendEmail({
      to: "delivered@resend.dev",
      subject: "Vylan prod email probe",
      html: "<p>probe</p>",
      text: "probe",
    });
  } catch (e) {
    sendProbe = { threw: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ keyPresent, fromEmail, appUrl, sendProbe });
}
