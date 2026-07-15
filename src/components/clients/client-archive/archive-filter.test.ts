import { describe, it, expect } from "vitest";
import { filterAndSortArchive, normalizeText, type ArchiveSortKey } from "./archive-filter";
import type {
  ArchiveEngagement,
  ArchiveFile,
  ArchiveCategoryKey,
} from "@/lib/db/client-archive";

function file(
  id: string,
  category: ArchiveCategoryKey,
  name: string,
  extra: Partial<ArchiveFile> = {},
): ArchiveFile {
  return {
    id,
    category,
    name,
    date: extra.date ?? "2025-01-01T00:00:00Z",
    status: extra.status ?? null,
    rejected: extra.rejected ?? false,
    sizeBytes: extra.sizeBytes ?? null,
  };
}

function eng(
  id: string,
  title: string,
  createdAt: string,
  categories: { key: ArchiveCategoryKey; files: ArchiveFile[] }[],
): ArchiveEngagement {
  const fileCount = categories.reduce((n, c) => n + c.files.length, 0);
  return {
    id,
    title,
    type: "t1",
    status: "complete",
    archived: false,
    createdAt,
    dueDate: null,
    categories,
    fileCount,
  };
}

const engagements: ArchiveEngagement[] = [
  eng("e2025", "2025 Personal Tax", "2025-02-01T00:00:00Z", [
    { key: "checklist", files: [file("f1", "checklist", "T4 2025.pdf"), file("f2", "checklist", "Relevé 2025.pdf")] },
    { key: "final", files: [file("f3", "final", "Return 2025.pdf")] },
  ]),
  eng("e2024", "2024 Personal Tax", "2024-02-01T00:00:00Z", [
    { key: "checklist", files: [file("f4", "checklist", "T4 2024.pdf")] },
    { key: "signed", files: [file("f5", "signed", "Engagement letter")] },
  ]),
  eng("e2023", "2023 Year-End", "2023-11-01T00:00:00Z", [
    { key: "final", files: [file("f6", "final", "Statements 2023.pdf")] },
  ]),
];

const baseOpts = {
  query: "",
  category: "all" as const,
  sort: "newest" as ArchiveSortKey,
  locale: "en" as const,
};

describe("normalizeText", () => {
  it("folds accents and case", () => {
    expect(normalizeText("Relevé")).toBe("releve");
    expect(normalizeText("ÉTÉ")).toBe("ete");
  });

  it("folds the French ligatures œ and æ so oe/ae spellings match", () => {
    expect(normalizeText("Sœur")).toBe("soeur");
    expect(normalizeText("CŒUR")).toBe("coeur");
    expect(normalizeText("curriculum vitæ")).toBe("curriculum vitae");
  });
});

describe("filterAndSortArchive", () => {
  it("returns everything (newest first) with no query/filter", () => {
    const r = filterAndSortArchive(engagements, baseOpts);
    expect(r.engagements.map((e) => e.id)).toEqual(["e2025", "e2024", "e2023"]);
    expect(r.matchedFiles).toBe(6);
  });

  it("searches file names case- and accent-insensitively", () => {
    const r = filterAndSortArchive(engagements, { ...baseOpts, query: "releve" });
    // Only the 2025 engagement has a matching file, and only that file shows.
    expect(r.engagements.map((e) => e.id)).toEqual(["e2025"]);
    const names = r.engagements[0].categories.flatMap((c) => c.files.map((f) => f.name));
    expect(names).toEqual(["Relevé 2025.pdf"]);
    expect(r.matchedFiles).toBe(1);
  });

  it("a matching engagement TITLE reveals all of that engagement's files", () => {
    const r = filterAndSortArchive(engagements, { ...baseOpts, query: "year-end" });
    expect(r.engagements.map((e) => e.id)).toEqual(["e2023"]);
    expect(r.engagements[0].fileCount).toBe(1);
  });

  it("searching a year across titles narrows to that engagement, all files shown", () => {
    const r = filterAndSortArchive(engagements, { ...baseOpts, query: "2024" });
    expect(r.engagements.map((e) => e.id)).toEqual(["e2024"]);
    // Title "2024 Personal Tax" matched -> both files (checklist + signed) show.
    expect(r.matchedFiles).toBe(2);
  });

  it("filters by category and hides engagements with none of it", () => {
    const r = filterAndSortArchive(engagements, { ...baseOpts, category: "signed" });
    expect(r.engagements.map((e) => e.id)).toEqual(["e2024"]);
    expect(r.engagements[0].categories.map((c) => c.key)).toEqual(["signed"]);
    expect(r.matchedFiles).toBe(1);
  });

  it("combines search AND category filter", () => {
    // "t4" matches checklist files in 2025 and 2024; category final removes both.
    const r = filterAndSortArchive(engagements, { ...baseOpts, query: "t4", category: "final" });
    expect(r.engagements).toHaveLength(0);
    expect(r.matchedFiles).toBe(0);
  });

  it("sorts oldest first", () => {
    const r = filterAndSortArchive(engagements, { ...baseOpts, sort: "oldest" });
    expect(r.engagements.map((e) => e.id)).toEqual(["e2023", "e2024", "e2025"]);
  });

  it("sorts by name A→Z and Z→A", () => {
    const az = filterAndSortArchive(engagements, { ...baseOpts, sort: "name_az" });
    expect(az.engagements.map((e) => e.title)).toEqual([
      "2023 Year-End",
      "2024 Personal Tax",
      "2025 Personal Tax",
    ]);
    const za = filterAndSortArchive(engagements, { ...baseOpts, sort: "name_za" });
    expect(za.engagements.map((e) => e.title)).toEqual([
      "2025 Personal Tax",
      "2024 Personal Tax",
      "2023 Year-End",
    ]);
  });

  it("returns no engagements for a non-matching search", () => {
    const r = filterAndSortArchive(engagements, { ...baseOpts, query: "zzzzz" });
    expect(r.engagements).toHaveLength(0);
    expect(r.matchedFiles).toBe(0);
  });

  it("does not mutate the input engagements", () => {
    const before = engagements.map((e) => e.fileCount);
    filterAndSortArchive(engagements, { ...baseOpts, query: "releve" });
    expect(engagements.map((e) => e.fileCount)).toEqual(before);
    // original order preserved
    expect(engagements[0].id).toBe("e2025");
  });
});
