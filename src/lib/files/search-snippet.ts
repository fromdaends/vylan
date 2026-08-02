// Render a ts_headline snippet SAFELY.
//
// Postgres wraps each matched word in <b></b>. That text originates in
// client-uploaded documents, so treating it as HTML would hand upload-content
// a path into the firm's DOM. Instead the snippet is split on the markers and
// the UI renders plain React elements — the only "HTML" that survives is the
// alternation this function returns.

export type SnippetPart = { text: string; marked: boolean };

export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  // Split keeps the alternation: even indexes are plain, odd are matches —
  // ts_headline never nests the markers.
  const pieces = snippet.split(/<\/?b>/);
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i] === "") continue;
    parts.push({ text: pieces[i], marked: i % 2 === 1 });
  }
  return parts;
}
