// @vitest-environment node
//
//   npm run qbo:post-e2e
//
// The half of the QuickBooks path that had never been run: an APPROVED draft
// going through the real orchestrator into a real sandbox company, and then the
// SAME transaction being offered again to prove duplicate protection stops it.
//
// Separate from e2e.check.ts (which starts from an upload) because the AI read
// needs a provider key that only the hosting environment has. This one starts
// from a draft the AI has already produced, so it can be run anywhere the
// QuickBooks connection is live.
//
// Set QBO_E2E_FILE_ID to the uploaded file whose draft you want posted.
//
// It writes to a SANDBOX company. Never point it at real books.

import { describe, it, expect, vi } from "vitest";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  getDraftForFile,
  saveResolvedPatch,
  setDraftStatus,
} from "@/lib/db/quickbooks-suggestions";
import { postApprovedDraftForFile } from "@/lib/xero/post";
import { getValidAccessToken } from "@/lib/quickbooks/connection";

vi.mock("next/server", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: () => {},
}));

// Reads normally go through the SIGNED-IN client, which needs a request scope
// and a browser session. Swap in the service-role client so the test can run
// from a command line. This deliberately steps around RLS — the row-level
// permission check is covered elsewhere; what is under test here is what gets
// written to QuickBooks.
vi.mock("@/lib/supabase/server", async (orig) => {
  const real = await orig<typeof import("@/lib/supabase/server")>();
  return { ...real, getServerSupabase: async () => real.getServiceRoleSupabase() };
});

const FILE_ID = process.env.QBO_E2E_FILE_ID!;
const REVIEWER = "2975e955-003a-48cb-b1e8-055be9a4f0bf";

async function qbo(
  firmId: string,
  clientId: string,
  realm: string,
  path: string,
) {
  const t = await getValidAccessToken(firmId, clientId);
  if (!t) throw new Error("no QuickBooks access token (expired, and refreshing needs QBO_CLIENT_ID/SECRET)");
  const r = await fetch(
    `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}/${path}`,
    { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } },
  );
  const body = await r.text();
  if (!r.ok) throw new Error(`QBO ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

describe("QuickBooks — approved draft to a transaction in the books", () => {
  it(
    "posts once, and refuses to post the same thing twice",
    async () => {
      const sb = getServiceRoleSupabase();
      const { data: conn } = await sb
        .from("quickbooks_connections")
        .select("firm_id, client_id, realm_id, home_currency")
        .limit(1)
        .single();
      const firmId = conn!.firm_id as string;
      const clientId = conn!.client_id as string;
      const realm = conn!.realm_id as string;

      // Real ids from this company's own lists, the way the pickers supply them.
      const { data: acct } = await sb
        .from("quickbooks_accounts")
        .select("qbo_id, name")
        .eq("account_type", "Expense")
        .limit(1)
        .single();
      const { data: vendor } = await sb
        .from("quickbooks_vendors")
        .select("qbo_id, name, currency")
        .eq("name", "Boreal Traiteur & Evenements inc.")
        .single();
      const { data: tax } = await sb
        .from("quickbooks_tax_codes")
        .select("qbo_id, name")
        .eq("name", "HST ON")
        .maybeSingle();
      console.log(
        "\nusing  vendor", `${vendor!.name} [${vendor!.qbo_id}, ${vendor!.currency}]`,
        "| account", `${acct!.name} [${acct!.qbo_id}]`,
        "| tax", tax ? `${tax.name} [${tax.qbo_id}]` : "(none)",
      );

      // ── Reset OUR record, never THEIR books ────────────────────────────────
      // Two hard-won rules live in this block.
      //
      // 1. Do NOT delete the transaction a previous run created. An earlier
      //    version did, and every run afterwards reported a bill that was not
      //    in the company — see rule 2 for why. A hard delete also makes
      //    QuickBooks reissue the freed id, so the wreckage looks like a
      //    posting bug rather than a test that ate its own evidence.
      //
      // 2. Vylan sends Intuit an idempotency key of `fileId-postAttempt`, and a
      //    repeat POST carrying a key Intuit has already seen returns the
      //    ORIGINAL transaction WITHOUT creating anything. That is exactly what
      //    you want in production — a retried post cannot double-charge — and
      //    it means a rerun must BUMP post_attempt or it is not posting at all,
      //    just replaying an old receipt.
      const { data: cur } = await sb
        .from("quickbooks_transaction_suggestions")
        .select("post_attempt")
        .eq("uploaded_file_id", FILE_ID)
        .single();
      const attempt = (Number(cur?.post_attempt) || 0) + 1;
      await sb
        .from("quickbooks_transaction_suggestions")
        .update({
          posted_qbo_id: null,
          posted_at: null,
          posted_status: null,
          posted_qbo_sync_token: null,
          matched_qbo_type: null,
          receipt_attached_at: null,
          post_attempt: attempt,
          status: "draft",
        })
        .eq("uploaded_file_id", FILE_ID);

      const before = await getDraftForFile(FILE_ID);
      expect(before, "no draft for that file").toBeTruthy();
      console.log(
        "draft ", before!.suggestion?.direction, before!.suggestion?.amount, before!.suggestion?.currency,
        "| status", before!.status, "| provider", before!.provider,
        "| date", before!.suggestion?.date,
      );
      expect(before!.provider).toBe("quickbooks");

      const patch = {
        party: { id: String(vendor!.qbo_id), name: String(vendor!.name) },
        account: { id: String(acct!.qbo_id), name: String(acct!.name) },
        ...(tax
          ? { taxCode: { id: String(tax.qbo_id), name: String(tax.name) } }
          : {}),
      };
      expect(
        await saveResolvedPatch({
          uploadedFileId: FILE_ID,
          patch,
          reviewerId: REVIEWER,
        }),
        "saving the accountant's picks failed",
      ).toBe(true);
      await setDraftStatus({
        uploadedFileId: FILE_ID,
        status: "approved",
        reviewerId: REVIEWER,
      });

      // ── Post ───────────────────────────────────────────────────────────────
      // matchAction 'create' is the accountant answering "no, this one is new"
      // — the same override the dialog sends. Used here so a bill left by an
      // earlier run cannot turn step one into a match instead of a post.
      const posted = await postApprovedDraftForFile(FILE_ID, REVIEWER, {
        match: { action: "create" },
      });
      console.log(
        "POST  ", posted.kind, posted.postedQboId ?? "",
        posted.detail ?? "", JSON.stringify(posted.problems ?? []),
      );
      expect(posted.kind, `post returned ${JSON.stringify(posted)}`).toBe("posted");

      // ── Prove it exists in THEIR books ─────────────────────────────────────
      const bill = (await qbo(firmId, clientId, realm, `bill/${posted.postedQboId}`)).Bill;
      console.log(
        "BOOKS  Bill", bill.Id, "| total", bill.TotalAmt, bill.CurrencyRef?.value,
        "| vendor", bill.VendorRef?.name, "| txn", bill.TxnDate, "| due", bill.DueDate,
        "| doc#", bill.DocNumber ?? "(none)",
      );
      expect(Number(bill.TotalAmt)).toBeCloseTo(Number(before!.suggestion!.amount), 2);
      expect(bill.CurrencyRef?.value).toBe(conn!.home_currency);
      expect(bill.VendorRef?.value).toBe(String(vendor!.qbo_id));

      // The receipt image itself. Read from Attachable, NOT from the Bill: a
      // Bill does not echo its AttachableRef, so checking the Bill reports zero
      // attachments however many there are — a check that lies in the
      // reassuring direction.
      const att = await qbo(
        firmId, clientId, realm,
        `query?query=${encodeURIComponent("select * from Attachable maxresults 200")}`,
      );
      const mine = (att.QueryResponse?.Attachable ?? []).filter(
        (a: { AttachableRef?: Array<{ EntityRef?: { value?: string } }> }) =>
          (a.AttachableRef ?? []).some((r) => r.EntityRef?.value === String(posted.postedQboId)),
      );
      console.log(
        "RECEIPT", mine.length, "attached to Bill", posted.postedQboId,
        mine.map((a: { FileName?: string }) => a.FileName).join(", "),
      );
      expect(
        mine.length,
        "the receipt image did not reach QuickBooks — the bill has no document on it",
      ).toBeGreaterThan(0);

      // Everything in the books for this vendor+date right now, so the end of
      // the check can prove the duplicate path added nothing to it.
      const billsBefore: string[] = (
        (
          await qbo(
            firmId, clientId, realm,
            `query?query=${encodeURIComponent(
              `select Id from Bill where VendorRef = '${vendor!.qbo_id}' and TxnDate = '${bill.TxnDate}'`,
            )}`,
          )
        ).QueryResponse?.Bill ?? []
      ).map((x: { Id: string }) => x.Id);

      // ── Duplicate protection ───────────────────────────────────────────────
      // Reopen and re-approve the SAME draft, then post again. The transaction
      // is now already in the books, so a second post must NOT create a second
      // one. This is the check that has never been run.
      await setDraftStatus({
        uploadedFileId: FILE_ID,
        status: "draft",
        reviewerId: REVIEWER,
      });
      // Fresh idempotency key again, so a replay cannot masquerade as the
      // duplicate check doing its job.
      await sb
        .from("quickbooks_transaction_suggestions")
        .update({
          posted_qbo_id: null,
          posted_at: null,
          posted_status: null,
          posted_qbo_sync_token: null,
          matched_qbo_type: null,
          post_attempt: attempt + 1,
        })
        .eq("uploaded_file_id", FILE_ID);
      await setDraftStatus({
        uploadedFileId: FILE_ID,
        status: "approved",
        reviewerId: REVIEWER,
      });

      const again = await postApprovedDraftForFile(FILE_ID, REVIEWER);
      const cands = (again.matchCandidates ?? []).map(
        (c) => `${c.entity}#${c.qboId} ${c.totalAmt} ${c.txnDate}${c.currency ? " " + c.currency : ""}`,
      );
      console.log("REPOST", again.kind, "| candidates:", cands.join(", ") || "(none)");
      expect(
        again.kind,
        "posting the same transaction again did NOT stop to ask — it would be counted twice",
      ).toBe("needs_match_confirmation");
      expect(
        (again.matchCandidates ?? []).some((c) => c.qboId === posted.postedQboId),
        "the bill just created was not offered as a match",
      ).toBe(true);

      // ── Attaching to the match must create nothing ─────────────────────────
      const attached = await postApprovedDraftForFile(FILE_ID, REVIEWER, {
        match: { action: "attach", qboId: posted.postedQboId!, entity: "bill" },
      });
      console.log("ATTACH", attached.kind, attached.postedQboId ?? "");
      expect(attached.kind).toBe("matched_existing");
      expect(attached.postedQboId).toBe(posted.postedQboId);

      // Did attaching CREATE anything? Compare the books before and after, not
      // an all-time count: every run of this check legitimately adds one bill,
      // so a total would fail for the wrong reason and teach everyone to ignore
      // it. The claim under test is narrower and sharper — the match path must
      // add nothing.
      const idsNow: string[] = (
        (
          await qbo(
            firmId, clientId, realm,
            `query?query=${encodeURIComponent(
              `select Id from Bill where VendorRef = '${vendor!.qbo_id}' and TxnDate = '${bill.TxnDate}'`,
            )}`,
          )
        ).QueryResponse?.Bill ?? []
      ).map((x: { Id: string }) => x.Id);
      console.log(
        "COUNT  bills for this vendor on", bill.TxnDate, "before duplicate step:",
        billsBefore.join(",") || "(none)", "| after:", idsNow.join(","),
      );
      expect(
        idsNow.filter((id) => !billsBefore.includes(id)),
        "the duplicate path created a NEW transaction — the expense is counted twice",
      ).toEqual([]);
    },
    300_000,
  );
});
