// Standalone page (renders OUTSIDE the portal's NextIntlClientProvider, so no
// t() is available) shown when a magic link is invalid/expired — at which point
// we don't know the visitor's language. The portal defaults to English, so
// English leads here too, with a French line below as a courtesy.
export default function NotFound() {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          background: "#fafaf9",
          color: "#1e293b",
          margin: 0,
          padding: 48,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: "0 0 12px 0" }}>
            Invalid or expired link
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            This link doesn&rsquo;t exist, has expired, or has been cancelled.
            Ask your accountant to send you a new one.
          </p>
          <p
            style={{
              color: "#64748b",
              margin: "16px 0 0 0",
              fontSize: 13,
            }}
          >
            Ce lien n&rsquo;existe pas, a expiré ou a été annulé. Demandez à
            votre comptable de vous envoyer un nouveau lien.
          </p>
        </div>
      </body>
    </html>
  );
}
