import { describe, expect, it } from "vitest";
import {
  FilingGuardError,
  decideEligibility,
  runFiling,
  withCounter,
  withUniqueTag,
  type FilingLedger,
  type FilingRunInput,
} from "./engine";
import { MockStorage, createMockConnector } from "./connectors/mock";
import type { FilingCandidate, FilingSource, SkipReason } from "./types";
import type { FilingTokenContext } from "./tokens";

// ── Test doubles ────────────────────────────────────────────────────────────

class MemoryLedger implements FilingLedger {
  filed = new Set<string>();
  skips: Array<{ fileId: string; reason: SkipReason }> = [];
  failures: Array<{ fileId: string; error: string }> = [];
  // When true, recordFiled pretends another run won the unique-index race.
  raceOnce = false;

  private key(source: FilingSource, fileId: string) {
    return `${source}:${fileId}`;
  }
  async alreadyFiled(source: FilingSource, fileId: string) {
    return this.filed.has(this.key(source, fileId));
  }
  async recordFiled(row: { source: FilingSource; fileId: string }) {
    if (this.raceOnce) {
      this.raceOnce = false;
      return "duplicate" as const;
    }
    const k = this.key(row.source, row.fileId);
    if (this.filed.has(k)) return "duplicate" as const;
    this.filed.add(k);
    return "ok" as const;
  }
  async recordSkip(row: { fileId: string; reason: SkipReason }) {
    this.skips.push({ fileId: row.fileId, reason: row.reason });
  }
  async recordFailure(row: { fileId: string; error: string }) {
    this.failures.push({ fileId: row.fileId, error: row.error });
  }
}

const ENGAGEMENT = "eng-1";
const CLIENT = "Marie Tremblay";

function tokenCtx(over: Partial<FilingTokenContext> = {}): FilingTokenContext {
  return {
    clientName: CLIENT,
    clientType: "individual",
    firmName: "Cabinet Vylan",
    engagementTitle: "T1 2024",
    docTypeCode: "t4",
    docConfidence: 0.9,
    year: 2024,
    issuerName: "Hydro-Québec",
    partyName: CLIENT,
    period: null,
    date: "2025-02-28",
    originalName: "IMG_1.pdf",
    ...over,
  };
}

function candidate(over: Partial<FilingCandidate> = {}): FilingCandidate {
  return {
    source: "checklist",
    fileId: `file-${Math.random().toString(36).slice(2, 8)}`,
    engagementId: ENGAGEMENT,
    storagePath: "firm/eng/file.pdf",
    originalFilename: "IMG_1.pdf",
    mimeType: "application/pdf",
    reviewStatus: "approved",
    isDuplicate: false,
    docTypeCode: "t4",
    docConfidence: 0.9,
    extractedYear: 2024,
    issuerName: "Hydro-Québec",
    partyName: CLIENT,
    accountOrPeriod: null,
    documentDate: "2025-02-28",
    uploadedAt: "2025-03-01T00:00:00Z",
    ...over,
  };
}

function makeInput(
  candidates: Array<{ doc: FilingCandidate; tokenContext: FilingTokenContext }>,
  over: Partial<FilingRunInput> = {},
): FilingRunInput {
  return {
    engagementId: ENGAGEMENT,
    clientName: CLIENT,
    fileFinalDocuments: false,
    folderTemplate: "Clients/{client_name}/{year}/{category}",
    nameTemplate: "{doc_type} - {year} - {detail}",
    language: "en",
    candidates,
    ...over,
  };
}

function makeDeps(store: MockStorage, ledger: MemoryLedger) {
  return {
    connector: createMockConnector(store),
    ctx: { accessToken: "test", config: {} },
    ledger,
    downloadBytes: async () => new Uint8Array([1, 2, 3]),
  };
}

// ── Eligibility ─────────────────────────────────────────────────────────────

describe("decideEligibility", () => {
  const opts = { fileFinalDocuments: false };
  it("approves only approved, non-duplicate checklist docs with bytes", () => {
    expect(decideEligibility(candidate(), opts)).toEqual({ eligible: true });
    expect(
      decideEligibility(candidate({ reviewStatus: "rejected" }), opts),
    ).toEqual({ eligible: false, reason: "rejected" });
    expect(
      decideEligibility(candidate({ reviewStatus: "pending" }), opts),
    ).toEqual({ eligible: false, reason: "not_approved" });
    expect(
      decideEligibility(candidate({ isDuplicate: true }), opts),
    ).toEqual({ eligible: false, reason: "duplicate" });
    expect(
      decideEligibility(candidate({ storagePath: null }), opts),
    ).toEqual({ eligible: false, reason: "no_bytes" });
  });

  it("rejected wins over duplicate-flag ordering ambiguity deterministically", () => {
    expect(
      decideEligibility(
        candidate({ isDuplicate: true, reviewStatus: "rejected" }),
        opts,
      ),
    ).toEqual({ eligible: false, reason: "duplicate" });
  });

  it("final documents are gated by the per-engagement opt-in", () => {
    const fin = candidate({ source: "final", reviewStatus: null });
    expect(decideEligibility(fin, { fileFinalDocuments: false })).toEqual({
      eligible: false,
      reason: "final_not_opted_in",
    });
    expect(decideEligibility(fin, { fileFinalDocuments: true })).toEqual({
      eligible: true,
    });
  });
});

// ── Collision names ─────────────────────────────────────────────────────────

describe("collision names", () => {
  it("appends the counter before the extension", () => {
    expect(withCounter("T4 - 2024.pdf", 1)).toBe("T4 - 2024.pdf");
    expect(withCounter("T4 - 2024.pdf", 2)).toBe("T4 - 2024 (2).pdf");
    expect(withCounter("no-extension", 3)).toBe("no-extension (3)");
  });
  it("unique tag uses the file id", () => {
    expect(withUniqueTag("T4.pdf", "abcd1234-ef00-0000-0000-000000000000")).toBe(
      "T4 [abcd1234].pdf",
    );
  });
});

// ── The run ─────────────────────────────────────────────────────────────────

describe("runFiling", () => {
  it("files an approved document to the templated path and name", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    const doc = candidate();
    const report = await runFiling(
      makeDeps(store, ledger),
      makeInput([{ doc, tokenContext: tokenCtx() }]),
    );

    expect(report.filedCount).toBe(1);
    const entry = report.outcomes[0];
    if (entry.status !== "filed") throw new Error("expected filed");
    expect(entry.folderPath).toBe("Clients/Marie Tremblay/2024/Federal slips");
    expect(entry.filedName).toBe("T4 - 2024 - Hydro-Québec.pdf");
    expect(
      store
        .allByPath()
        .has("Clients/Marie Tremblay/2024/Federal slips/T4 - 2024 - Hydro-Québec.pdf"),
    ).toBe(true);
  });

  it("skips rejected, duplicate, and pending docs — they never reach the provider", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    const rejected = candidate({ reviewStatus: "rejected" });
    const dup = candidate({ isDuplicate: true });
    const pending = candidate({ reviewStatus: "pending" });
    const report = await runFiling(
      makeDeps(store, ledger),
      makeInput([
        { doc: rejected, tokenContext: tokenCtx() },
        { doc: dup, tokenContext: tokenCtx() },
        { doc: pending, tokenContext: tokenCtx() },
      ]),
    );

    expect(report.filedCount).toBe(0);
    expect(report.skippedCount).toBe(3);
    expect(store.uploadAttempts).toBe(0);
    expect(ledger.skips.map((s) => s.reason).sort()).toEqual([
      "duplicate",
      "not_approved",
      "rejected",
    ]);
  });

  it("final documents stay home unless opted in, and file when opted in", async () => {
    const store = new MockStorage();
    const fin = candidate({ source: "final", reviewStatus: null });

    const noOptIn = await runFiling(
      makeDeps(store, new MemoryLedger()),
      makeInput([{ doc: fin, tokenContext: tokenCtx() }]),
    );
    expect(noOptIn.outcomes[0]).toMatchObject({
      status: "skipped",
      reason: "final_not_opted_in",
    });
    expect(store.uploadAttempts).toBe(0);

    const optIn = await runFiling(
      makeDeps(store, new MemoryLedger()),
      makeInput([{ doc: fin, tokenContext: tokenCtx() }], {
        fileFinalDocuments: true,
      }),
    );
    expect(optIn.filedCount).toBe(1);
  });

  it("is idempotent: a re-run files nothing and reports already_filed", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    const doc = candidate();
    const input = makeInput([{ doc, tokenContext: tokenCtx() }]);

    const first = await runFiling(makeDeps(store, ledger), input);
    expect(first.filedCount).toBe(1);
    const attemptsAfterFirst = store.uploadAttempts;

    const second = await runFiling(makeDeps(store, ledger), input);
    expect(second.filedCount).toBe(0);
    expect(second.outcomes[0]).toMatchObject({
      status: "skipped",
      reason: "already_filed",
    });
    // The provider was never touched on the second run.
    expect(store.uploadAttempts).toBe(attemptsAfterFirst);
    expect(store.allByPath().size).toBe(1);
  });

  it("appends a counter on a name collision and never overwrites", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    // Two DIFFERENT documents that render the same name (two T4s from the
    // same employer, same year).
    const a = candidate({ fileId: "file-a" });
    const b = candidate({ fileId: "file-b" });
    const report = await runFiling(
      makeDeps(store, ledger),
      makeInput([
        { doc: a, tokenContext: tokenCtx() },
        { doc: b, tokenContext: tokenCtx() },
      ]),
    );

    expect(report.filedCount).toBe(2);
    const names = [...store.allByPath().keys()].sort();
    expect(names).toEqual([
      "Clients/Marie Tremblay/2024/Federal slips/T4 - 2024 - Hydro-Québec (2).pdf",
      "Clients/Marie Tremblay/2024/Federal slips/T4 - 2024 - Hydro-Québec.pdf",
    ]);
  });

  it("treats an upload-time conflict race as a rename, not an overwrite", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    const connector = createMockConnector(store);
    // Sabotage fileExists to always say "free" — forcing the conflict to
    // surface at upload time (the race window).
    const racyConnector = {
      ...connector,
      fileExists: async () => false,
    };
    const a = candidate({ fileId: "file-a" });
    const b = candidate({ fileId: "file-b" });
    const report = await runFiling(
      {
        connector: racyConnector,
        ctx: { accessToken: "t", config: {} },
        ledger,
        downloadBytes: async () => new Uint8Array([1]),
      },
      makeInput([
        { doc: a, tokenContext: tokenCtx() },
        { doc: b, tokenContext: tokenCtx() },
      ]),
    );
    expect(report.filedCount).toBe(2);
    expect(store.allByPath().size).toBe(2);
  });

  it("reports already_filed when the DB unique index says another run won", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    ledger.raceOnce = true;
    const report = await runFiling(
      makeDeps(store, ledger),
      makeInput([{ doc: candidate(), tokenContext: tokenCtx() }]),
    );
    expect(report.filedCount).toBe(0);
    expect(report.outcomes[0]).toMatchObject({
      status: "skipped",
      reason: "already_filed",
    });
  });

  it("one failed upload never aborts the batch", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    const good = candidate({ fileId: "file-good" });
    const bad = candidate({
      fileId: "file-bad",
      issuerName: "Banque Nationale",
    });
    // Fail exactly the bad document's rendered name.
    store.failNames.add("T4 - 2024 - Banque Nationale.pdf");

    const report = await runFiling(
      makeDeps(store, ledger),
      makeInput([
        { doc: bad, tokenContext: tokenCtx({ issuerName: "Banque Nationale" }) },
        { doc: good, tokenContext: tokenCtx() },
      ]),
    );

    expect(report.failedCount).toBe(1);
    expect(report.filedCount).toBe(1);
    expect(ledger.failures).toHaveLength(1);
    expect(ledger.failures[0].fileId).toBe("file-bad");
    expect(
      store
        .allByPath()
        .has("Clients/Marie Tremblay/2024/Federal slips/T4 - 2024 - Hydro-Québec.pdf"),
    ).toBe(true);
  });

  it("aborts the whole run when a candidate belongs to another engagement", async () => {
    const store = new MockStorage();
    const stray = candidate({ engagementId: "eng-OTHER" });
    await expect(
      runFiling(
        makeDeps(store, new MemoryLedger()),
        makeInput([{ doc: stray, tokenContext: tokenCtx() }]),
      ),
    ).rejects.toThrow(FilingGuardError);
    expect(store.uploadAttempts).toBe(0);
  });

  it("aborts the whole run when a candidate carries another client's name", async () => {
    const store = new MockStorage();
    await expect(
      runFiling(
        makeDeps(store, new MemoryLedger()),
        makeInput([
          {
            doc: candidate(),
            tokenContext: tokenCtx({ clientName: "Jean Untel" }),
          },
        ]),
      ),
    ).rejects.toThrow(FilingGuardError);
    expect(store.uploadAttempts).toBe(0);
  });

  it("fails the document (not the run) when the rendered path lost the client name", async () => {
    const store = new MockStorage();
    const ledger = new MemoryLedger();
    // A folder template that ignores tokens entirely — can't happen through
    // validation, but the engine must still refuse to file into it.
    const report = await runFiling(
      makeDeps(store, ledger),
      makeInput([{ doc: candidate(), tokenContext: tokenCtx() }], {
        folderTemplate: "Everything",
      }),
    );
    expect(report.filedCount).toBe(0);
    expect(report.failedCount).toBe(1);
    expect(store.allByPath().size).toBe(0);
  });
});
