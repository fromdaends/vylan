// Storage-key-safe filenames. Supabase Storage rejects object keys with
// characters outside its allowed set — ASCII word characters plus a short
// punctuation list. Accented letters are NOT allowed, so a Quebec-French
// filename like "Régie de l'assurance maladie.jpeg" made every storage write
// fail with "invalid key" (the portal showed a persistent generic "upload
// failed"). This helper makes a name safe for STORAGE KEYS ONLY — the
// original filename, accents and all, is still what's stored in the DB and
// shown everywhere in the UI.
export function safeStorageName(filename: string): string {
  const safe = filename
    // Split accented characters into base + combining mark, drop the marks:
    // é -> e, ç -> c, etc.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Anything still outside the conservative safe set becomes "_" (covers
    // apostrophes, quotes, emoji, CJK, the lot).
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    // Tidy: collapse runs, trim leading/trailing separators.
    .replace(/_{2,}/g, "_")
    .replace(/^[_.]+|[_]+$/g, "")
    .slice(0, 120);
  return safe || "file";
}
