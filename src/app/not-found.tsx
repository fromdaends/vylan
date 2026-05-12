// Top-level fallback for any path that doesn't match a route. The locale
// layout's html/body don't wrap this because Next renders the root layout
// here, so we ship a self-contained bilingual page.

import Link from "next/link";

export default function NotFound() {
  return (
    <html lang="fr">
      <body
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          background: "#fafaf9",
          color: "#1e293b",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              color: "#64748b",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            404
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              margin: "0 0 12px 0",
              lineHeight: 1.2,
            }}
          >
            Page introuvable
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            Cette page n&apos;existe pas ou a été supprimée.
          </p>
          <p
            style={{
              color: "#64748b",
              margin: "16px 0 0 0",
              fontSize: 13,
            }}
          >
            This page doesn&apos;t exist or has been removed.
          </p>
          <div style={{ marginTop: 32 }}>
            <Link
              href="/"
              style={{
                display: "inline-block",
                background: "#1e293b",
                color: "#fafaf9",
                padding: "10px 20px",
                borderRadius: 8,
                textDecoration: "none",
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              Retour à l&apos;accueil
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
