// Build a safe Content-Disposition header for serving an uploaded file.
//
// Filenames are user-controlled — clients name their own uploads, often with
// accented Québec characters ("Relevé_2024.pdf") — so we must both keep the
// real name AND make it impossible to break out of / inject into the header:
//   - the legacy ASCII `filename="…"` param is stripped of quotes, backslashes,
//     CR/LF and non-ASCII so it can never corrupt the header,
//   - an RFC 5987 `filename*=UTF-8''…` carries the true accented name, which
//     every modern browser prefers, so downloads keep their proper name.
export function buildContentDisposition(
  filename: string,
  download: boolean,
): string {
  const type = download ? "attachment" : "inline";
  const asciiFallback =
    filename
      .replace(/[\r\n"\\]/g, "_")
      // Drop non-ASCII for the legacy param; the UTF-8 one below carries truth.
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x20-\x7E]/g, "_")
      .slice(0, 200) || "file";
  const utf8 = encodeURIComponent(filename);
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${utf8}`;
}
