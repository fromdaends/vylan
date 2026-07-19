// @vitest-environment node
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractReadable } from "./readable-extract";

// Build a valid single-page PDF (proper xref, so pdf.js doesn't fall into
// recovery mode) whose content stream is `content`. `hasFont` wires a Helvetica
// resource for pages that draw text.
function makePdf(content: string, hasFont: boolean): Buffer {
  const pageObj = hasFont
    ? "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>"
    : "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>";
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    pageObj,
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
    ...(hasFont ? ["<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"] : []),
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets[i] = Buffer.byteLength(body);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  const trailer = `trailer<</Root 1 0 R/Size ${objs.length + 1}>>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body + xref + trailer, "latin1");
}

// A text-layer PDF: several Tj runs (pdf.js reads multi-run layout the way real
// documents are typeset).
function makeTextPdf(lines: string[]): Buffer {
  let content = "BT /F1 12 Tf 72 720 Td";
  lines.forEach((l, i) => {
    content += (i === 0 ? " " : " 0 -16 Td ") + `(${l}) Tj`;
  });
  content += " ET";
  return makePdf(content, true);
}

// An image-only (scanned) PDF: no text-drawing operators, so pdf.js finds ~no
// text.
function makeImageOnlyPdf(): Buffer {
  return makePdf("q 1 0 0 1 0 0 cm Q", false);
}

// A minimal .xlsx (a ZIP of the XML parts fflate can build directly).
function makeXlsx(): Buffer {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?><workbook><sheets><sheet name="Ventes" sheetId="1"/></sheets></workbook>',
    ),
    "xl/sharedStrings.xml": strToU8(
      '<?xml version="1.0"?><sst><si><t>Date</t></si><si><t>Montant</t></si><si><t>Rapport 2024</t></si></sst>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1234.56</v></c></row>' +
        "</sheetData></worksheet>",
    ),
  };
  return Buffer.from(zipSync(files));
}

describe("extractReadable", () => {
  it("reads a text-layer PDF and reports it as code-readable", async () => {
    // Several runs, together well over the >100 alphanumeric-char text-layer floor.
    const res = await extractReadable(
      makeTextPdf([
        "Statement of Remuneration Paid RL-1 T4",
        "Employment income Box 14 Total 2024",
        "Employer Hydro Quebec Amount 45230.00",
        "Federal tax 6120 Provincial 3200 CPP EI",
      ]),
      "application/pdf",
      "t4.pdf",
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("pdf_text");
    expect(res!.char_count).toBeGreaterThanOrEqual(100);
    expect(res!.text_preview).toContain("Remuneration");
    expect(res!.extracted_year).toBe(2024);
  });

  it("returns null for an image-only (scanned) PDF so it goes to the AI path", async () => {
    const res = await extractReadable(
      makeImageOnlyPdf(),
      "application/pdf",
      "scan.pdf",
    );
    expect(res).toBeNull();
  });

  it("reads a CSV: headers, data-row count, and a year", async () => {
    const csv = "Date,Amount\n2024-01-15,100.50\n2024-02-01,200.00\n";
    const res = await extractReadable(
      Buffer.from(csv, "utf8"),
      "text/csv",
      "ledger.csv",
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("csv");
    expect(res!.column_headers).toEqual(["Date", "Amount"]);
    expect(res!.row_count).toBe(2);
    expect(res!.extracted_year).toBe(2024);
  });

  it("detects CSV by extension even when the MIME is generic", async () => {
    const res = await extractReadable(
      Buffer.from("a,b\n1,2\n", "utf8"),
      "application/octet-stream",
      "export.csv",
    );
    expect(res?.kind).toBe("csv");
  });

  it("reads an .xlsx: sheet names, headers, shared strings, and a year", async () => {
    const res = await extractReadable(
      makeXlsx(),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "book.xlsx",
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("xlsx");
    expect(res!.sheet_names).toEqual(["Ventes"]);
    expect(res!.column_headers).toEqual(["Date", "Montant"]);
    expect(res!.row_count).toBe(1);
    expect(res!.text_preview).toContain("1234.56");
    expect(res!.extracted_year).toBe(2024);
  });

  it("keeps shared-string indices aligned across a self-closing <si/>", async () => {
    // Index 2 must resolve to "Gamma", not shift to "Beta", when an empty
    // <si/> occupies index 1.
    const files: Record<string, Uint8Array> = {
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="S"/></sheets></workbook>',
      ),
      "xl/sharedStrings.xml": strToU8(
        "<sst><si><t>Alpha</t></si><si/><si><t>Gamma</t></si></sst>",
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1">' +
          '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c>' +
          "</row></sheetData></worksheet>",
      ),
    };
    const res = await extractReadable(
      Buffer.from(zipSync(files)),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "s.xlsx",
    );
    expect(res!.column_headers).toEqual(["Alpha", "Gamma"]);
  });

  it("does not read a year out of a decimal amount", async () => {
    const noYear = await extractReadable(
      Buffer.from("price\n2019.99\n2020.00\n", "utf8"),
      "text/csv",
      "p.csv",
    );
    expect(noYear!.extracted_year).toBeNull();
    const withYear = await extractReadable(
      Buffer.from("label,amount\nRapport 2024,100\n", "utf8"),
      "text/csv",
      "r.csv",
    );
    expect(withYear!.extracted_year).toBe(2024);
  });

  it("stays bounded on a crafted worksheet with no closing '>' (no quadratic hang)", async () => {
    // Without bounded quantifiers this row body would trigger O(n^2) regex
    // backtracking. With them it returns quickly; assert it completes and yields
    // a result rather than hanging the event loop.
    const evil =
      "<worksheet><sheetData><row>" + "<c".repeat(200_000) + "</row></sheetData></worksheet>";
    const files: Record<string, Uint8Array> = {
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="S"/></sheets></workbook>'),
      "xl/worksheets/sheet1.xml": strToU8(evil),
    };
    // The 5s per-test timeout below is the guard: a quadratic scan would blow it.
    const res = await extractReadable(
      Buffer.from(zipSync(files)),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "evil.xlsx",
    );
    // The malformed row yields no cells; we still get a (kind:"xlsx") result.
    expect(res?.kind).toBe("xlsx");
  }, 5000);

  it("treats a legacy binary .xls (OLE) as readable but with minimal extraction", async () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(64), // padding
    ]);
    const res = await extractReadable(ole, "application/vnd.ms-excel", "old.xls");
    expect(res?.kind).toBe("xls");
    expect(res?.char_count).toBe(0);
  });

  it("returns null for images (they need the vision model)", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await extractReadable(png, "image/png", "photo.png")).toBeNull();
    expect(await extractReadable(png, "image/jpeg", "photo.jpg")).toBeNull();
  });

  it("returns null for an Excel-claimed file whose bytes are neither ZIP nor OLE", async () => {
    const res = await extractReadable(
      Buffer.from("not really a spreadsheet"),
      "application/vnd.ms-excel",
      "fake.xls",
    );
    expect(res).toBeNull();
  });

  it("exposes the extracted text (fed to the classifier) for readable files", async () => {
    const csv = await extractReadable(
      Buffer.from("name,amount\nAcme,100\n", "utf8"),
      "text/csv",
      "x.csv",
    );
    expect(csv!.text).toContain("Acme");
  });
});
