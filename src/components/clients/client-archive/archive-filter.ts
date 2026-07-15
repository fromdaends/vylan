// Pure search / sort / filter logic for the client document archive, split out
// so it can be unit-tested without React. The archive is filtered entirely in
// the browser against the already-fetched ClientArchive (no server round-trip),
// mirroring how the clients list filters in memory.

import type { AppLocale } from "@/lib/format";
import type {
  ArchiveEngagement,
  ArchiveCategoryGroup,
  ArchiveCategoryKey,
} from "@/lib/db/client-archive";

export const ARCHIVE_SORT_OPTIONS = ["newest", "oldest", "name_az", "name_za"] as const;
export type ArchiveSortKey = (typeof ARCHIVE_SORT_OPTIONS)[number];

export const ARCHIVE_CATEGORY_FILTERS = ["all", "checklist", "signed", "final"] as const;
export type ArchiveCategoryFilter = (typeof ARCHIVE_CATEGORY_FILTERS)[number];

// Combining diacritical marks (U+0300–U+036F) plus the precomposed French
// ligatures œ (U+0153) and æ (U+00E6), built with escapes so the file stays
// plain ASCII and unambiguous. NFKD does not decompose œ/æ, so they are mapped
// explicitly.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const LIG_OE = new RegExp("\\u0153", "g");
const LIG_AE = new RegExp("\\u00e6", "g");

// Fold accents, ligatures, and case so a search for "releve" finds "Relevé" and
// "soeur" finds "Sœur" (French/Québec text). Lowercasing first collapses Œ→œ and
// Æ→æ so only the lowercase ligatures need mapping; NFKD then decomposes accents
// (é→e+◌́) and compatibility ligatures (ﬁ→fi) before the combining marks are
// stripped.
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(LIG_OE, "oe")
    .replace(LIG_AE, "ae")
    .normalize("NFKD")
    .replace(DIACRITICS, "");
}

export type FilteredArchive = {
  engagements: ArchiveEngagement[];
  matchedFiles: number;
};

// Filter by search term (file name OR engagement title, accent-insensitive) and
// by category, then sort the surviving engagements. Returns fresh objects — the
// input is never mutated. Each returned engagement's `fileCount` reflects only
// the files that survived filtering, so the UI counts stay honest.
export function filterAndSortArchive(
  engagements: ArchiveEngagement[],
  opts: {
    query: string;
    category: ArchiveCategoryFilter;
    sort: ArchiveSortKey;
    locale: AppLocale;
  },
): FilteredArchive {
  const q = normalizeText(opts.query.trim());
  const hasQuery = q.length > 0;

  const out: ArchiveEngagement[] = [];
  let matchedFiles = 0;

  for (const eng of engagements) {
    // A title match reveals ALL of the engagement's files (still category-scoped);
    // otherwise only files whose name matches are shown.
    const titleMatch = hasQuery ? normalizeText(eng.title).includes(q) : true;

    const groups: ArchiveCategoryGroup[] = [];
    let fileCount = 0;
    for (const group of eng.categories) {
      if (opts.category !== "all" && group.key !== (opts.category as ArchiveCategoryKey)) {
        continue;
      }
      const files =
        !hasQuery || titleMatch
          ? group.files
          : group.files.filter((f) => normalizeText(f.name).includes(q));
      if (files.length > 0) {
        groups.push({ key: group.key, files });
        fileCount += files.length;
      }
    }

    if (fileCount === 0) continue; // nothing visible for this engagement
    out.push({ ...eng, categories: groups, fileCount });
    matchedFiles += fileCount;
  }

  sortEngagements(out, opts.sort, opts.locale);
  return { engagements: out, matchedFiles };
}

function sortEngagements(
  list: ArchiveEngagement[],
  sort: ArchiveSortKey,
  locale: AppLocale,
): void {
  // Intl.Collator so accented French titles order correctly; ISO dates sort
  // lexicographically so localeCompare on the string works for time sorts.
  const collator = new Intl.Collator(locale === "fr" ? "fr-CA" : "en-CA", {
    sensitivity: "base",
  });
  switch (sort) {
    case "newest":
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "oldest":
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "name_az":
      list.sort(
        (a, b) => collator.compare(a.title, b.title) || b.createdAt.localeCompare(a.createdAt),
      );
      break;
    case "name_za":
      list.sort(
        (a, b) => collator.compare(b.title, a.title) || b.createdAt.localeCompare(a.createdAt),
      );
      break;
  }
}
