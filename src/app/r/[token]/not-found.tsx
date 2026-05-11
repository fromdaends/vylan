export default function NotFound() {
  return (
    <html lang="fr">
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
            Lien invalide ou expiré
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            Ce lien n’existe pas, a expiré ou a été annulé. Demandez à votre
            comptable de vous envoyer un nouveau lien.
          </p>
          <p
            style={{
              color: "#64748b",
              margin: "16px 0 0 0",
              fontSize: 13,
            }}
          >
            This link is invalid, expired, or has been cancelled. Ask your
            accountant to send a new one.
          </p>
        </div>
      </body>
    </html>
  );
}
