// Phase 6 smoke test — validate the toolchain + key on ONE synthetic T4.
//   npx tsx scripts/ai-eval/smoke.mts
import { readFileSync } from "node:fs";

// Self-load .env.local (classify.ts reads ANTHROPIC_API_KEY from process.env).
if (!process.env.ANTHROPIC_API_KEY) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const sharp = (await import("sharp")).default;
const { classifyDocument } = await import("../../src/lib/ai/classify");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="520">
  <rect width="700" height="520" fill="#ffffff"/>
  <text x="40" y="60" font-family="Arial" font-size="26" fill="#111">T4 Statement of Remuneration Paid</text>
  <text x="40" y="110" font-family="Arial" font-size="18" fill="#111">Tax year: 2024    Employer: Maple Tech Inc.</text>
  <text x="40" y="150" font-family="Arial" font-size="18" fill="#111">Employee: Jean Tremblay</text>
  <text x="40" y="190" font-family="Arial" font-size="18" fill="#111">Box 14 - Employment income: 58,200.00</text>
  <text x="40" y="230" font-family="Arial" font-size="18" fill="#111">Box 22 - Income tax deducted: 9,540.00</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
console.log("rendered PNG:", png.length, "bytes");
console.log("calling the real classifier (expected: t4)…");
const res = await classifyDocument({
  expectedDocType: "t4" as never,
  fileBytes: png,
  mimeType: "image/png",
});
console.log(JSON.stringify(res, null, 2));
