// SHA-256 in the BROWSER.
//
// lib/files/content-hash.ts uses Node's `crypto` and therefore cannot run in a
// client component — the import wizard hashes files in the browser (that is
// where the bytes are) and needs Web Crypto instead.
//
// The two must agree byte for byte, because the whole point of the hash is that
// an imported file can be recognised as a duplicate of one the client already
// sent through the portal. Same algorithm, same lowercase hex encoding.

/** Lowercase hex SHA-256 of the given bytes, using the browser's Web Crypto. */
export async function computeContentHashWeb(
  bytes: Uint8Array,
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  // Web Crypto is unavailable on insecure origins other than localhost. Rather
  // than fail the import, return null and let the file be stored without a
  // fingerprint — it simply will not participate in duplicate detection, which
  // is a far better outcome than refusing to import it.
  if (!subtle) return null;
  const digest = await subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
