// Provider marks for the Document filing surface. Plain inline SVGs sized by
// className, brand-color fills — same pattern as QuickbooksLogo / XeroLogo.

import type { StorageProvider } from "@/lib/filing/types";

// Google Drive tricolor triangle (Simple Icons "Google Drive").
export function GoogleDriveLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#0066DA"
        d="M1.813 18.164 2.87 19.99c.22.384.536.686.906.906l3.777-6.536H0c0 .427.11.855.33 1.24l1.483 2.564Z"
      />
      <path
        fill="#00AC47"
        d="M12 7.64 8.223 1.104a2.474 2.474 0 0 0-.906.906L.33 14.12A2.48 2.48 0 0 0 0 15.36h7.553L12 7.64Z"
      />
      <path
        fill="#EA4335"
        d="M20.224 20.896c.37-.22.686-.522.906-.906l.44-.755 2.1-3.635c.22-.385.33-.813.33-1.24h-7.554l1.608 3.157 2.17 3.38Z"
      />
      <path
        fill="#00832D"
        d="m12 7.64 3.777-6.536A2.437 2.437 0 0 0 14.537.775H9.463c-.44 0-.865.124-1.24.33L12 7.64Z"
      />
      <path
        fill="#2684FC"
        d="M16.446 15.36H7.553l-3.777 6.536c.375.206.8.33 1.24.33h13.968c.44 0 .865-.138 1.24-.33l-3.778-6.536Z"
      />
      <path
        fill="#FFBA00"
        d="m20.18 8.068-3.494-6.058a2.474 2.474 0 0 0-.906-.906L12 7.64l4.446 7.72h7.54c0-.427-.11-.855-.33-1.24l-3.475-6.052Z"
      />
    </svg>
  );
}

// Microsoft four-square mark — the connector covers SharePoint AND OneDrive,
// so the neutral Microsoft logo is the honest choice over either product's.
export function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}

// Dropbox glyph (Simple Icons "Dropbox"), brand blue #0061FF.
export function DropboxLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#0061FF"
        d="M6 1.807 0 5.629l6 3.822 6.001-3.822L6 1.807ZM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822ZM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822ZM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822ZM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371Z"
      />
    </svg>
  );
}

// SmartVault has no widely-distributed simple mark; a vault-door glyph in
// their navy keeps the card recognizable without imitating a trademark.
export function SmartVaultLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="4"
        fill="none"
        stroke="#1F3B63"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        r="5"
        fill="none"
        stroke="#1F3B63"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="1.6" fill="#1F3B63" />
      <path
        d="M12 7v-2M12 19v-2M7 12H5M19 12h-2"
        stroke="#1F3B63"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ONE place that maps a provider to its mark. Every surface that shows a
// storage provider (Filing settings' hero and provider rows, the Files Home
// cloud card) goes through this — so adding a provider, or fixing a logo, is
// one edit rather than a hunt through the screens that happen to draw one.
export function ProviderLogo({
  provider,
  className,
}: {
  provider: StorageProvider;
  className?: string;
}) {
  switch (provider) {
    case "google_drive":
      return <GoogleDriveLogo className={className} />;
    case "microsoft":
      return <MicrosoftLogo className={className} />;
    case "dropbox":
      return <DropboxLogo className={className} />;
    case "smartvault":
      return <SmartVaultLogo className={className} />;
  }
}
