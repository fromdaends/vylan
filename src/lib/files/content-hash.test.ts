import { describe, it, expect } from "vitest";
import { computeContentHash } from "./content-hash";

describe("computeContentHash", () => {
  it("is deterministic — identical bytes produce the identical hash (so a re-upload matches)", () => {
    const a = computeContentHash(Buffer.from("the same document bytes"));
    const b = computeContentHash(Buffer.from("the same document bytes"));
    expect(a).toBe(b);
  });

  it("matches the known SHA-256 of a known input", () => {
    // SHA-256("abc") — a standard test vector.
    expect(computeContentHash(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("differs for different bytes (no false collision)", () => {
    expect(computeContentHash(Buffer.from("file-a"))).not.toBe(
      computeContentHash(Buffer.from("file-b")),
    );
  });

  it("a single-byte difference changes the hash", () => {
    expect(computeContentHash(Buffer.from("document"))).not.toBe(
      computeContentHash(Buffer.from("documentt")),
    );
  });

  it("hashes the same whether given a Buffer or a Uint8Array of the same bytes", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    expect(computeContentHash(buf)).toBe(computeContentHash(arr));
  });

  it("returns a 64-char lowercase hex string", () => {
    expect(computeContentHash(Buffer.from("x"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
