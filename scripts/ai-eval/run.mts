// Phase 6 evaluation harness — renders synthetic tax documents, runs them
// through the REAL classifier + matcher, and scores classification, extraction,
// expected-vs-actual mismatch flags, and quality detection.
//   npx tsx scripts/ai-eval/run.mts
import { readFileSync } from "node:fs";

if (!process.env.ANTHROPIC_API_KEY) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const sharp = (await import("sharp")).default;
const { classifyDocument } = await import("../../src/lib/ai/classify");
const { matchDocument } = await import("../../src/lib/ai/matching");

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function docSvg(lines: string[]): string {
  const W = 760,
    H = 60 + lines.length * 38 + 40;
  const rows = lines
    .map(
      (l, i) =>
        `<text x="44" y="${64 + i * 38}" font-family="Arial, Helvetica, sans-serif" font-size="${i === 0 ? 26 : 18}" fill="#111">${esc(l)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${rows}</svg>`;
}
async function render(lines: string[], blur = 0): Promise<Buffer> {
  const base = await sharp(Buffer.from(docSvg(lines))).png().toBuffer();
  return blur > 0 ? sharp(base).blur(blur).png().toBuffer() : base;
}

const CLIENT = "Jean Tremblay";
type Case = {
  name: string;
  lines: string[];
  blur?: number;
  expectedDocType: string;
  expectedYear: number | null;
  clientName: string | null;
  want: { type?: string; flag?: string; usableMaybe?: boolean };
};
const cases: Case[] = [
  {
    name: "T4 (clean)",
    lines: ["T4 Statement of Remuneration Paid", "Tax year: 2024    Employer: Maple Tech Inc.", "Employee: Jean Tremblay", "Box 14 - Employment income: 58,200.00", "Box 22 - Income tax deducted: 9,540.00"],
    expectedDocType: "t4", expectedYear: 2024, clientName: CLIENT, want: { type: "t4" },
  },
  {
    name: "RL-1 (Quebec, French)",
    lines: ["Releve 1 - Revenus d'emploi et revenus divers", "Annee: 2024    Employeur: Boulangerie Levis inc.", "Nom du particulier: Jean Tremblay", "Case A - Revenus d'emploi: 47,300.00", "Revenu Quebec"],
    expectedDocType: "rl1", expectedYear: 2024, clientName: CLIENT, want: { type: "rl1" },
  },
  {
    name: "Bank statement",
    lines: ["Monthly Account Statement", "Maple Trust Bank", "Account holder: Jean Tremblay", "Statement period: January 1 - January 31, 2024", "Opening balance: 3,240.18", "Total deposits: 4,100.00   Total withdrawals: 3,224.26", "Closing balance: 4,115.92"],
    expectedDocType: "bank_statement", expectedYear: 2024, clientName: CLIENT, want: { type: "bank_statement" },
  },
  {
    name: "Credit card statement",
    lines: ["Visa Credit Card Statement", "Cardholder: Jean Tremblay", "Card number: XXXX XXXX XXXX 4821", "Statement period: Jan 1 - Jan 31, 2024", "Credit limit: 5,000.00", "New balance: 842.55    Minimum payment due: 35.00"],
    expectedDocType: "credit_card_statement", expectedYear: 2024, clientName: CLIENT, want: { type: "credit_card_statement" },
  },
  {
    name: "T4 - WRONG YEAR (slip is 2023, item expects 2024)",
    lines: ["T4 Statement of Remuneration Paid", "Tax year: 2023    Employer: Maple Tech Inc.", "Employee: Jean Tremblay", "Box 14 - Employment income: 55,100.00"],
    expectedDocType: "t4", expectedYear: 2024, clientName: CLIENT, want: { type: "t4", flag: "year_mismatch" },
  },
  {
    name: "T4 - WRONG NAME (Marie Gagnon, client is Jean Tremblay)",
    lines: ["T4 Statement of Remuneration Paid", "Tax year: 2024    Employer: Northwind Co.", "Employee: Marie Gagnon", "Box 14 - Employment income: 41,800.00"],
    expectedDocType: "t4", expectedYear: 2024, clientName: CLIENT, want: { type: "t4", flag: "identity_mismatch" },
  },
  {
    name: "T4A where a T4 was requested (type confusion)",
    lines: ["T4A Statement of Pension, Retirement, Annuity, and Other Income", "Tax year: 2024    Payer: Sunlife Financial", "Recipient: Jean Tremblay", "Box 048 - Fees for services: 12,000.00"],
    expectedDocType: "t4", expectedYear: 2024, clientName: CLIENT, want: { type: "t4a", flag: "type_mismatch" },
  },
  {
    name: "T4 - BLURRY scan",
    lines: ["T4 Statement of Remuneration Paid", "Tax year: 2024    Employer: Maple Tech Inc.", "Employee: Jean Tremblay", "Box 14 - Employment income: 58,200.00"],
    blur: 7, expectedDocType: "t4", expectedYear: 2024, clientName: CLIENT, want: { type: "t4", usableMaybe: true },
  },
];

let typeOk = 0, typeTotal = 0, flagOk = 0, flagTotal = 0;
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const bytes = await render(c.lines, c.blur ?? 0);
  const t0 = Date.now();
  const res = await classifyDocument({ expectedDocType: c.expectedDocType as never, fileBytes: bytes, mimeType: "image/png" });
  const latencyMs = Date.now() - t0;
  console.log("\n" + "-".repeat(74));
  console.log(`[${i + 1}] ${c.name}`);
  console.log(`    EXPECTED: type=${c.expectedDocType}  year=${c.expectedYear}  client=${c.clientName}`);
  if (!res) { console.log("    -> NO RESULT (null)"); continue; }
  const flags = matchDocument({
    expectedDocType: c.expectedDocType as never, expectedYear: c.expectedYear, clientName: c.clientName,
    classification: { document_type: res.document_type, confidence: res.confidence, extracted_year: res.extracted_year, party_name: res.party_name, fields_confidence: res.fields_confidence },
  });
  console.log(`    -> type=${res.document_type} (conf ${res.confidence})  second_guess=${res.second_guess ? `${res.second_guess.document_type}@${res.second_guess.confidence}` : "-"}`);
  console.log(`       reasoning: ${res.reasoning}`);
  console.log(`       fields: year=${res.extracted_year} party=${res.party_name ?? "-"} issuer=${res.issuer_name ?? "-"} period=${res.account_or_period ?? "-"} form=${res.form_identifier ?? "-"} (fconf ${res.fields_confidence})`);
  console.log(`       amounts: ${res.amounts.map((a) => `${a.label}=${a.value}`).join(" | ") || "-"}`);
  console.log(`       usability: usable=${res.usability.usable} (conf ${res.usability.confidence}) issue=${res.usability.primary_issue ?? "-"}`);
  console.log(`       MATCH FLAGS: ${flags.length ? flags.map((f) => `${f.kind}[${Math.round(f.confidence * 100)}%: ${f.expected} -> ${f.actual}]`).join("   ") : "none"}`);
  console.log(`       latency: ${latencyMs} ms`);
  if (c.want.type) { typeTotal++; const ok = res.document_type === c.want.type; if (ok) typeOk++; console.log(`       ${ok ? "PASS" : "FAIL"} - type ${ok ? "correct" : `wrong (wanted ${c.want.type})`}`); }
  if (c.want.flag) { flagTotal++; const ok = flags.some((f) => f.kind === c.want.flag); if (ok) flagOk++; console.log(`       ${ok ? "PASS" : "FAIL"} - ${c.want.flag} ${ok ? "fired" : "did NOT fire"}`); }
  if (c.want.usableMaybe) console.log(`       (blurry: usable=${res.usability.usable} - either outcome acceptable, noting only)`);
}
console.log("\n" + "=".repeat(74));
console.log(`SUMMARY: classification ${typeOk}/${typeTotal} correct  |  mismatch flags ${flagOk}/${flagTotal} fired correctly`);
