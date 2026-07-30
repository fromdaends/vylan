import { describe, expect, it } from "vitest";
import {
  AUTO_MATCH_CONFIDENCE,
  isImportableType,
  isJunkFile,
  matchFolderToClient,
  planImport,
  type DroppedFile,
} from "./import-plan";

const MAX = 25 * 1024 * 1024;

const file = (path: string, over: Partial<DroppedFile> = {}): DroppedFile => ({
  path,
  name: path.split("/").pop() ?? path,
  size: 1000,
  mimeType: "application/pdf",
  ...over,
});

describe("isJunkFile", () => {
  it("skips the OS litter every historical folder is full of", () => {
    expect(isJunkFile("Tremblay/.DS_Store")).toBe(true);
    expect(isJunkFile("Tremblay/Thumbs.db")).toBe(true);
    expect(isJunkFile("Tremblay/desktop.ini")).toBe(true);
    expect(isJunkFile("Tremblay/._t4.pdf")).toBe(true);
  });

  it("skips shortcuts, which point at files rather than being them", () => {
    expect(isJunkFile("Tremblay/Payroll.lnk")).toBe(true);
    expect(isJunkFile("Tremblay/Bank.url")).toBe(true);
  });

  it("keeps real documents", () => {
    expect(isJunkFile("Tremblay/2023/t4.pdf")).toBe(false);
    expect(isJunkFile("Tremblay/relevé 1.jpg")).toBe(false);
  });
});

describe("isImportableType", () => {
  it("accepts what the bucket actually accepts", () => {
    expect(isImportableType("application/pdf", "t4.pdf")).toBe(true);
    expect(isImportableType("image/jpeg", "scan.jpg")).toBe(true);
    expect(isImportableType("image/png", "scan.png")).toBe(true);
  });

  it("falls back to the extension when the browser gives no type", () => {
    // Browsers routinely leave File.type empty; rejecting a valid PDF over a
    // missing header would drop real documents.
    expect(isImportableType("", "t4.pdf")).toBe(true);
    expect(isImportableType("", "scan.HEIC")).toBe(true);
  });

  it("rejects Office files, which the storage bucket refuses", () => {
    // Not a preference — the bucket's allowlist. The wizard names these files
    // rather than dropping them silently.
    expect(isImportableType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "letter.docx")).toBe(false);
    expect(isImportableType("text/csv", "ledger.csv")).toBe(false);
    expect(isImportableType("application/zip", "backup.zip")).toBe(false);
  });
});

describe("planImport", () => {
  it("groups by the top-level folder, which is what maps to a client", () => {
    const groups = planImport(
      [
        file("Tremblay Inc/2023/t4.pdf"),
        file("Tremblay Inc/2024/t4.pdf"),
        file("Gagnon/2023/rl1.pdf"),
      ],
      MAX,
    );
    expect(groups.map((g) => g.folder)).toEqual(["Tremblay Inc", "Gagnon"]);
    expect(groups[0].count).toBe(2);
  });

  it("puts the biggest folders first", () => {
    const groups = planImport(
      [file("A/1.pdf"), file("B/1.pdf"), file("B/2.pdf"), file("B/3.pdf")],
      MAX,
    );
    expect(groups[0].folder).toBe("B");
  });

  it("keeps loose files in their own unnamed group rather than guessing", () => {
    // Attaching them to whichever client sorted first would file a document
    // under someone who never sent it.
    const groups = planImport([file("stray.pdf")], MAX);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBe("");
  });

  it("marks junk, oversized, empty and unsupported files instead of dropping them", () => {
    const groups = planImport(
      [
        file("T/.DS_Store"),
        file("T/huge.pdf", { size: MAX + 1 }),
        file("T/empty.pdf", { size: 0 }),
        file("T/notes.docx", { mimeType: "application/msword", name: "notes.docx" }),
        file("T/good.pdf"),
      ],
      MAX,
    );
    const reasons = groups[0].files.map((f) => f.skip ?? "ok");
    expect(reasons).toEqual([
      "junk",
      "too_large",
      "empty",
      "unsupported_type",
      "ok",
    ]);
    expect(groups[0].count).toBe(1);
    expect(groups[0].skipped).toBe(4);
  });

  it("counts only importable bytes", () => {
    const groups = planImport(
      [file("T/a.pdf", { size: 100 }), file("T/.DS_Store", { size: 900 })],
      MAX,
    );
    expect(groups[0].bytes).toBe(100);
  });
});

describe("matchFolderToClient", () => {
  const clients = [
    { id: "c1", name: "Tremblay Inc" },
    { id: "c2", name: "Marie Gagnon" },
    { id: "c3", name: "BellaVista Restaurant Inc." },
  ];

  it("matches an exact folder name confidently", () => {
    const m = matchFolderToClient("Tremblay Inc", clients);
    expect(m.clientId).toBe("c1");
    expect(m.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_CONFIDENCE);
  });

  it("ignores case, accents and punctuation", () => {
    expect(matchFolderToClient("tremblay, inc.", clients).clientId).toBe("c1");
    expect(matchFolderToClient("MARIE GAGNON", clients).clientId).toBe("c2");
  });

  it("handles reordered names", () => {
    expect(matchFolderToClient("Gagnon Marie", clients).clientId).toBe("c2");
  });

  it("does not let a legal suffix create a false match", () => {
    // Without stripping "Inc", every incorporated client shares a token and
    // an unrelated folder would match one of them.
    const m = matchFolderToClient("Nowhere Inc", clients);
    expect(m.clientId).toBeNull();
  });

  it("treats a bare surname as an exact match once the suffix is stripped", () => {
    // "Tremblay" and "Tremblay Inc" are the same identity — that is the whole
    // point of dropping legal suffixes, and there is only one Tremblay here.
    const m = matchFolderToClient("Tremblay", clients);
    expect(m.clientId).toBe("c1");
    expect(m.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_CONFIDENCE);
  });

  it("demotes a match when two clients are equally good fits", () => {
    // THE case worth protecting against: two clients that are indistinguishable
    // once legal suffixes are stripped. "Tremblay" matches both perfectly, so
    // pre-selecting either would file a client's entire history under the wrong
    // name with a tick beside it. It must ask instead.
    const ambiguous = [
      { id: "a", name: "Tremblay Inc" },
      { id: "b", name: "Tremblay Ltd" },
    ];
    const m = matchFolderToClient("Tremblay", ambiguous);
    expect(m.confidence).toBeLessThan(AUTO_MATCH_CONFIDENCE);
  });

  it("does not demote when the runner-up is genuinely a worse fit", () => {
    // "Tremblay Holdings" keeps a token "Tremblay" does not, so it is not a
    // near-tie and the exact match should still be pre-selected.
    const m = matchFolderToClient("Tremblay", [
      { id: "a", name: "Tremblay Inc" },
      { id: "b", name: "Tremblay Holdings Ltd" },
    ]);
    expect(m.clientId).toBe("a");
    expect(m.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_CONFIDENCE);
  });

  it("still trusts a clear winner over a distant runner-up", () => {
    const m = matchFolderToClient("BellaVista Restaurant", clients);
    expect(m.clientId).toBe("c3");
    expect(m.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_CONFIDENCE);
  });

  it("returns nothing for an unrecognisable folder", () => {
    expect(matchFolderToClient("Misc scans 2019", clients).clientId).toBeNull();
    expect(matchFolderToClient("", clients).clientId).toBeNull();
  });

  it("returns nothing when the firm has no clients", () => {
    expect(matchFolderToClient("Tremblay Inc", []).clientId).toBeNull();
  });
});
