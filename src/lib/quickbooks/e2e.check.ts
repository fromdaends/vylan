// @vitest-environment node
//
//   QBO_E2E_RECEIPT=/path/to/receipt.jpg QBO_E2E_ITEM_ID=<request item> npm run qbo:e2e
//
// A document going in one end of Vylan and a QuickBooks draft coming out the
// other, through the same functions the app calls:
//
//   ingestPortalUpload  — the shared intake behind BOTH upload routes
//   the AI read         — locally if a provider key is configured, otherwise by
//                         asking the deployment to run the job already queued
//   getDraftForFile     — what the accountant would actually see
//
// It stops at the draft. Posting that draft — and the duplicate protection that
// stops it being posted twice — is post-e2e.check.ts, which starts from a draft
// precisely so it can run without an AI key.
//
// WHY IT DOES NOT JUST CALL THE AI. Extraction needs the provider key that the
// hosting environment has and a laptop generally does not. Rather than copy the
// key down, this hands the work to the deployment: ingestPortalUpload already
// enqueues a durable classify job for the cron to retry, so nudging that cron is
// the app's own mechanism doing its own job, and the result is what PRODUCTION's
// model produced rather than whatever happens to be configured locally.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { ingestPortalUpload } from "@/lib/portal/ingest-upload";
import { processClassifyJob } from "@/lib/ai/process";
import { isAiConfigured } from "@/lib/ai/classify";
import { getDraftForFile } from "@/lib/db/quickbooks-suggestions";

// The intake defers notification emails to next/server's `after()`, which needs
// a request scope no test has. Swallow them: this is a test of the pipeline, and
// it must not email anyone about a document nobody sent.
vi.mock("next/server", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: () => {},
}));

vi.mock("@/lib/supabase/server", async (orig) => {
  const real = await orig<typeof import("@/lib/supabase/server")>();
  return { ...real, getServerSupabase: async () => real.getServiceRoleSupabase() };
});

const RECEIPT = process.env.QBO_E2E_RECEIPT!;
const ITEM_ID = process.env.QBO_E2E_ITEM_ID!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a document arriving, read, and turned into a draft", () => {
  it(
    "produces a bookkeeping draft the accountant can act on",
    async () => {
      expect(
        RECEIPT && ITEM_ID,
        "set QBO_E2E_RECEIPT (a file) and QBO_E2E_ITEM_ID (a PENDING request item on a live engagement)",
      ).toBeTruthy();

      const sb = getServiceRoleSupabase();
      const { data: item } = await sb
        .from("request_items")
        .select("*")
        .eq("id", ITEM_ID)
        .single();
      expect(item, "no request item with that id").toBeTruthy();
      const { data: engagement } = await sb
        .from("engagements")
        .select("id, firm_id, title, assigned_user_id, client_id")
        .eq("id", item!.engagement_id)
        .single();

      // ── The document arrives ───────────────────────────────────────────────
      const res = await ingestPortalUpload({
        bytes: readFileSync(RECEIPT),
        declaredMime: "image/jpeg",
        originalFilename: `E2E ${RECEIPT.split("/").pop()}`,
        item: item!,
        engagement: engagement!,
        uploadedByIp: null,
      });
      expect(res.ok, `intake failed: ${JSON.stringify(res)}`).toBe(true);
      const fileId = (res as { fileId: string }).fileId;
      console.log("\nINTAKE file", fileId, (res as { duplicate?: boolean }).duplicate ? "(duplicate of an earlier upload)" : "");

      // ── The AI read ────────────────────────────────────────────────────────
      if (isAiConfigured()) {
        await processClassifyJob({ uploaded_file_id: fileId });
        console.log("READ   locally");
      } else {
        const base = process.env.APP_URL ?? "https://vylan.app";
        const secret = process.env.CRON_SECRET;
        expect(
          secret,
          "no AI provider configured locally and no CRON_SECRET to hand the job to the deployment",
        ).toBeTruthy();
        console.log("READ   no local AI key — asking", base, "to run the queued job");
        // The job is enqueued a couple of minutes out so a burst of photos is
        // classified together; wait for it to become due, then nudge.
        for (let i = 0; i < 10; i++) {
          const r = await fetch(`${base}/api/cron/process-jobs`, {
            headers: { Authorization: `Bearer ${secret}` },
          });
          const body = (await r.json()) as { claimed?: number };
          if (await getDraftForFile(fileId)) break;
          console.log(`       attempt ${i + 1}: claimed ${body.claimed ?? 0}`);
          await sleep(20_000);
        }
      }

      // ── What the accountant sees ───────────────────────────────────────────
      const draft = await getDraftForFile(fileId);
      expect(
        draft,
        "the document produced no draft — either the AI could not read it, or it was not a transaction",
      ).toBeTruthy();
      const s = draft!.suggestion!;
      console.log(
        "DRAFT ", draft!.provider, s.direction, s.amount, s.currency,
        "| date", s.date, "| due", s.dueDate ?? "-", "| ref", s.reference ?? "-",
        "| party", s.party?.match?.name ?? "(unmatched)",
        "\n       post it with:  QBO_E2E_FILE_ID=" + fileId + " npm run qbo:post",
      );
      expect(s.amount).toBeGreaterThan(0);
    },
    600_000,
  );
});
