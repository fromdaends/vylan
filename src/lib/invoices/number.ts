// Invoice number formatting — pure and dependency-free so BOTH server code
// (creation, PDF) and client components (the settings preview, the builder's
// live preview) can import it without dragging server-only modules along.

// number = prefix + seq zero-padded to 4 (grows naturally past 9999).
export function formatInvoiceNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(4, "0")}`;
}
