export const brand = {
  name: "Relai",
  tagline: {
    fr: "La paperasse client, automatisée.",
    en: "Client paperwork, automated.",
  },
  domain: "relai.app",
  supportEmail: "support@relai.app",
  colors: {
    primary: "#1e293b",
    background: "#fafaf9",
    success: "#15803d",
    warning: "#d97706",
    danger: "#b91c1c",
    muted: "#64748b",
    border: "#e2e8f0",
  },
  fonts: {
    sans: "Inter",
    mono: "JetBrains Mono",
  },
} as const;

export type Brand = typeof brand;
