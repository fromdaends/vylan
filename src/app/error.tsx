"use client";

import { useEffect } from "react";

// Top-level error boundary. Triggered when an unhandled error escapes the
// root layout. Bilingual + recover-by-retry, no app shell since the shell
// itself might be what threw.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error.tsx]", error);
  }, [error]);

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
            maxWidth: 520,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              color: "#b91c1c",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            500
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              margin: "0 0 12px 0",
              lineHeight: 1.2,
            }}
          >
            Quelque chose a mal tourné
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            Nous travaillons à le réparer. Vous pouvez réessayer ou revenir
            plus tard.
          </p>
          <p
            style={{
              color: "#64748b",
              margin: "16px 0 0 0",
              fontSize: 13,
            }}
          >
            Something went wrong on our end. Please try again.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 24,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                color: "#94a3b8",
              }}
            >
              Erreur ID : {error.digest}
            </p>
          )}
          <div style={{ marginTop: 32, display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                background: "#1e293b",
                color: "#fafaf9",
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                fontWeight: 500,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.assign("/");
              }}
              style={{
                background: "transparent",
                color: "#1e293b",
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                fontWeight: 500,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Accueil
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
