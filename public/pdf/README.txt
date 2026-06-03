Vendored pdf.js assets for the in-app document viewer (react-pdf).

Files here are copied verbatim from node_modules/pdfjs-dist and committed so the
viewer never depends on a CDN (matters for a financial app + CSP + offline dev).

Current source version: pdfjs-dist@5.4.296

When react-pdf / pdfjs-dist is upgraded, REFRESH these by re-running:
  cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf/pdf.worker.min.mjs
  cp node_modules/pdfjs-dist/standard_fonts/* public/pdf/standard_fonts/
A worker whose version differs from the installed pdfjs API will refuse to
render ("API version does not match Worker version").
