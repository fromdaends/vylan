// Evaluation set for the bookkeeping pipeline.
//
// Each case is a REAL document (rendered to a PNG by render.mjs) plus the
// answers a competent bookkeeper would give for it. The runner puts the document
// through the actual pipeline — the same extraction prompt and the same matcher
// the product uses — and scores what came out.
//
// The point is to have a NUMBER. Until now the only evidence that any of this
// works was individual cases someone happened to look at, which is how a whole
// field stayed broken for sales invoices until a founder tested one by hand.
//
// The reference lists below are a fixed stand-in for a client's connected
// books, modelled on Xero's Demo Company. Fixed on purpose: matching has to be
// deterministic for the score to mean anything, and it lets the ground truth
// name the exact id that should be picked.

// How the document was acquired. Rendering every case as a pristine 760px
// screenshot flattered the result: real documents are phone photos taken at an
// angle, thermal rolls that have faded in a wallet, or photocopies. See
// render.ts for what each one does to the image.
export type Capture = "clean" | "photo" | "thermal" | "faded";

export type Truth = {
  direction: "expense" | "income";
  // The other party as the matcher should resolve it, or null when the document
  // genuinely does not name one that exists in the books.
  partyId: string | null;
  // Expense: the chart-of-accounts entry. Income: the product/service.
  // null = a competent bookkeeper could not pick this from the document alone,
  // so the right behaviour is to ASK rather than guess.
  accountId?: string | null;
  itemId?: string | null;
  taxCodeId: string | null;
  total: number;
  documentNumber: string | null;
  documentDate: string; // ISO
  paid: boolean;
  // Does the document itemise? Sales invoices need this to identify a product,
  // and it is exactly what the extractor used to refuse to read.
  hasLineItems: boolean;
  // Scored ONLY when the document states a currency in words or a code. Left
  // undefined for a receipt that just prints "$", where inferring CAD from the
  // GST line is reasonable and marking it wrong would be noise.
  currency?: string;
};

export type EvalCase = {
  id: string;
  note: string;
  html: string;
  // Defaults to "clean".
  capture?: Capture;
  // A document that is NOT a purchase or a sale — a business card, a bank
  // statement, a letter. The right answer is to read NOTHING rather than
  // manufacture a transaction from it, so these carry no truth. Inventing a
  // total here is the worst failure the pipeline has: it puts a number in a
  // client's books that has no document behind it.
  expectNoTransaction?: boolean;
  truth?: Truth;
};

// ── The client's books (fixed) ───────────────────────────────────────────────

export const ACCOUNTS = [
  { id: "acc-400", name: "Advertising", accountType: "Expense", active: true },
  { id: "acc-420", name: "Entertainment", accountType: "Expense", active: true },
  { id: "acc-429", name: "General Expenses", accountType: "Expense", active: true },
  { id: "acc-433", name: "Office Supplies", accountType: "Expense", active: true },
  { id: "acc-449", name: "Motor Vehicle Expenses", accountType: "Expense", active: true },
  { id: "acc-453", name: "Telephone & Internet", accountType: "Expense", active: true },
  { id: "acc-469", name: "Repairs and Maintenance", accountType: "Expense", active: true },
  { id: "acc-200", name: "Sales", accountType: "Revenue", active: true },
  { id: "acc-260", name: "Other Revenue", accountType: "Revenue", active: true },
  { id: "acc-090", name: "Business Bank Account", accountType: "Bank", active: true },
];

export const CONTACTS = [
  { id: "con-hd", name: "The Home Depot", active: true, isSupplier: true, isCustomer: false },
  { id: "con-bell", name: "Bell Canada", active: true, isSupplier: true, isCustomer: false },
  { id: "con-boreal", name: "Boréal Traiteur & Événements", active: true, isSupplier: true, isCustomer: false },
  { id: "con-petro", name: "Petro-Canada", active: true, isSupplier: true, isCustomer: false },
  { id: "con-eastside", name: "Eastside Club", active: true, isSupplier: false, isCustomer: true },
  { id: "con-ridgeway", name: "Ridgeway Bank", active: true, isSupplier: false, isCustomer: true },
];

export const TAX_RATES = [
  { id: "CAN-GST", name: "GST on Purchases", active: true, canApplyToRevenue: false, canApplyToExpenses: true },
  { id: "CAN-GST-SALES", name: "GST on Income", active: true, canApplyToRevenue: true, canApplyToExpenses: false },
  { id: "CAN-GSTQST", name: "GST/QST on Purchases", active: true, canApplyToRevenue: false, canApplyToExpenses: true },
  { id: "CAN-GSTQST-SALES", name: "GST/QST on Income", active: true, canApplyToRevenue: true, canApplyToExpenses: false },
  { id: "CAN-GSTRST", name: "GST/RST on Purchases", active: true, canApplyToRevenue: false, canApplyToExpenses: true },
  { id: "CAN-GSTRST-SALES", name: "GST/RST on Income", active: true, canApplyToRevenue: true, canApplyToExpenses: false },
  { id: "CAN-HST", name: "HST on Purchases", active: true, canApplyToRevenue: false, canApplyToExpenses: true },
  { id: "CAN-HST-SALES", name: "HST on Income", active: true, canApplyToRevenue: true, canApplyToExpenses: false },
  { id: "CAN-EXEMPT", name: "Tax Exempt", active: true, canApplyToRevenue: true, canApplyToExpenses: true },
];

export const ITEMS = [
  { id: "itm-dev-hour", name: "Development work - per hour rate", itemType: "Service", incomeAccountId: "acc-200", active: true },
  { id: "itm-dev-day", name: "Development work - developer onsite per day", itemType: "Service", incomeAccountId: "acc-200", active: true },
  { id: "itm-brand", name: "Project management & implementation - branding", itemType: "Service", incomeAccountId: "acc-200", active: true },
  { id: "itm-golf-1", name: "Golf balls - white single", itemType: "Inventory", incomeAccountId: "acc-260", active: true },
];

// ── Document chrome ──────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;background:#fff;color:#111;
 width:760px;padding:44px 52px;font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
.hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}
h1{font-size:19px;letter-spacing:-.2px}
.muted{color:#666;font-size:12px}
.kind{font-size:24px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#14508c;text-align:right}
hr{border:0;border-top:2px solid #14508c;margin:16px 0 20px}
table{width:100%;border-collapse:collapse;margin:14px 0}
th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#888;
 padding:0 0 7px;border-bottom:1px solid #ddd}
th.r,td.r{text-align:right}
td{padding:10px 0;border-bottom:1px solid #f1f1f1;vertical-align:top}
td .sub{color:#777;font-size:11px;margin-top:2px}
.tot{width:290px;margin-left:auto}
.tot td{border:0;padding:4px 0;font-size:12px}
.tot tr.g td{border-top:2px solid #14508c;padding-top:10px;font-size:15px;font-weight:700}
.meta{display:flex;justify-content:space-between;margin-bottom:8px}
.lbl{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#888;font-weight:600;margin-bottom:4px}
.pay{margin-top:26px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#555}
.tender{margin-top:18px;padding:10px 12px;background:#f6f6f6;border-radius:6px;font-size:12px}
`;

const page = (body: string) => `<style>${CSS}</style>${body}`;

// ── The cases ────────────────────────────────────────────────────────────────

export const CASES: EvalCase[] = [
  {
    id: "expense-paid-card",
    note: "Point-of-sale receipt, paid by card. The everyday case.",
    truth: {
      direction: "expense",
      partyId: "con-hd",
      accountId: null, // nothing on the paper says which expense account
      taxCodeId: "CAN-GST",
      total: 89.24,
      documentNumber: "4471-0092",
      documentDate: "2026-05-12",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>THE HOME DEPOT</h1>
        <p class="muted">1245 St James St, Winnipeg MB<br/>GST/HST 10001 2345 RT0001</p></div>
        <div class="kind">Receipt</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>May 12, 2026 &nbsp; 14:22</div>
        <div><div class="lbl">Receipt #</div>4471-0092</div></div>
      <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Cordless drill kit 18V</td><td class="r">1</td><td class="r">$64.99</td></tr>
        <tr><td>Drywall screws 1-5/8" box</td><td class="r">2</td><td class="r">$20.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$84.99</td></tr>
        <tr><td>GST 5%</td><td class="r">$4.25</td></tr>
        <tr class="g"><td>Total</td><td class="r">$89.24</td></tr>
      </table>
      <div class="tender"><strong>VISA ************4127</strong> &nbsp; APPROVED &nbsp; $89.24<br/>
        Auth 004182 &nbsp; Ref 0092 &nbsp; <strong>PAID</strong></div>`),
  },

  {
    id: "expense-unpaid-net30",
    note: "Supplier bill on terms — must NOT read as paid.",
    truth: {
      direction: "expense",
      partyId: "con-bell",
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 178.5,
      documentNumber: "BC-99120",
      documentDate: "2026-06-01",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>Bell Canada</h1>
        <p class="muted">Business Services<br/>GST/HST 10063 4567 RT0001</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta">
        <div><div class="lbl">Bill to</div><strong>ABC Incorporation Inc.</strong></div>
        <div><div class="lbl">Invoice no.</div>BC-99120<br/>
          <div class="lbl" style="margin-top:8px">Invoice date</div>June 1, 2026<br/>
          <div class="lbl" style="margin-top:8px">Terms</div>Net 30 — due July 1, 2026</div></div>
      <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Business internet — fibre 500<div class="sub">Service period June 2026</div></td><td class="r">$120.00</td></tr>
        <tr><td>Business phone line<div class="sub">2 lines, unlimited Canada</div></td><td class="r">$50.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$170.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$8.50</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$178.50</td></tr>
      </table>
      <div class="pay"><strong>Remit to Bell Canada.</strong> Payable by EFT or cheque.<br/>
        Please quote invoice BC-99120. Late accounts bear interest at 1.5% monthly.</div>`),
  },

  {
    id: "sales-invoice-unpaid",
    note: "Sales invoice on terms. The case that was silently broken — line items were never read for income.",
    truth: {
      direction: "income",
      partyId: "con-eastside",
      itemId: "itm-dev-hour",
      taxCodeId: "CAN-GSTRST-SALES",
      total: 6720,
      documentNumber: "INV-2041",
      documentDate: "2026-07-18",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>ABC Incorporation Inc.</h1>
        <p class="muted">1450 Portage Ave, Winnipeg MB<br/>GST/HST 81234 5678 RT0001 · MB RST 123456-7</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta">
        <div><div class="lbl">Bill to</div><strong>Eastside Club</strong><br/>
          <span class="muted">88 Lakeshore Road, Winnipeg MB</span></div>
        <div><div class="lbl">Invoice no.</div>INV-2041<br/>
          <div class="lbl" style="margin-top:8px">Date</div>July 18, 2026<br/>
          <div class="lbl" style="margin-top:8px">Terms</div>Net 30</div></div>
      <table><thead><tr><th>Description</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Development work — per hour rate<div class="sub">Member portal build, sprint 4</div></td>
          <td class="r">32.0</td><td class="r">$150.00</td><td class="r">$4,800.00</td></tr>
        <tr><td>Development work — per hour rate<div class="sub">Booking system integration</div></td>
          <td class="r">8.0</td><td class="r">$150.00</td><td class="r">$1,200.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$6,000.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$300.00</td></tr>
        <tr><td>MB RST 7%</td><td class="r">$420.00</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$6,720.00</td></tr>
      </table>
      <div class="pay"><strong>Remit to ABC Incorporation Inc.</strong> EFT — transit 00021, account 1049772.</div>`),
  },

  {
    id: "sales-receipt-paid",
    note: "A sale already settled — must read as paid, unlike the invoice above.",
    truth: {
      direction: "income",
      partyId: "con-ridgeway",
      itemId: "itm-brand",
      taxCodeId: "CAN-GST-SALES",
      total: 2625,
      documentNumber: "REC-3310",
      documentDate: "2026-06-22",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>ABC Incorporation Inc.</h1>
        <p class="muted">GST/HST 81234 5678 RT0001</p></div>
        <div class="kind">Receipt</div></div><hr/>
      <div class="meta">
        <div><div class="lbl">Received from</div><strong>Ridgeway Bank</strong></div>
        <div><div class="lbl">Receipt no.</div>REC-3310<br/>
          <div class="lbl" style="margin-top:8px">Date</div>June 22, 2026</div></div>
      <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Project management &amp; implementation - branding<div class="sub">Phase 1 delivery</div></td>
          <td class="r">$2,500.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$2,500.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$125.00</td></tr>
        <tr class="g"><td>Total</td><td class="r">$2,625.00</td></tr>
      </table>
      <div class="tender"><strong>PAID IN FULL</strong> — received by EFT on June 22, 2026.<br/>
        Thank you for your payment.</div>`),
  },

  {
    id: "expense-french-quebec",
    note: "French receipt with TPS/TVQ — the bilingual case a Quebec firm lives on.",
    truth: {
      direction: "expense",
      partyId: "con-boreal",
      accountId: null,
      taxCodeId: "CAN-GSTQST",
      total: 574.88,
      documentNumber: "F-20268",
      documentDate: "2026-04-30",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>Boréal Traiteur &amp; Événements inc.</h1>
        <p class="muted">2200 rue Notre-Dame O, Montréal QC<br/>TPS 12345 6789 RT0001 · TVQ 1098765432 TQ0001</p></div>
        <div class="kind">Facture</div></div><hr/>
      <div class="meta">
        <div><div class="lbl">Facturé à</div><strong>ABC Incorporation Inc.</strong></div>
        <div><div class="lbl">N° de facture</div>F-20268<br/>
          <div class="lbl" style="margin-top:8px">Date</div>30 avril 2026</div></div>
      <table><thead><tr><th>Description</th><th class="r">Montant</th></tr></thead><tbody>
        <tr><td>Service de traiteur — réunion annuelle<div class="sub">45 personnes</div></td><td class="r">$450.00</td></tr>
        <tr><td>Location de vaisselle</td><td class="r">$50.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Sous-total</td><td class="r">$500.00</td></tr>
        <tr><td>TPS 5%</td><td class="r">$25.00</td></tr>
        <tr><td>TVQ 9,975%</td><td class="r">$49.88</td></tr>
        <tr class="g"><td>Total</td><td class="r">$574.88</td></tr>
      </table>
      <div class="tender"><strong>PAYÉ</strong> — Visa ************9931, approuvé.</div>`),
  },

  {
    id: "expense-no-number",
    note: "No invoice number anywhere — the reference fallback case.",
    truth: {
      direction: "expense",
      partyId: "con-petro",
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 78.75,
      documentNumber: null,
      documentDate: "2026-05-03",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>PETRO-CANADA</h1>
        <p class="muted">Station 07731 — Winnipeg MB<br/>GST 85623 1122 RT0001</p></div>
        <div class="kind">Receipt</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>May 3, 2026 &nbsp; 08:14</div>
        <div><div class="lbl">Pump</div>04</div></div>
      <table><thead><tr><th>Item</th><th class="r">Litres</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Regular unleaded</td><td class="r">48.62</td><td class="r">$75.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$75.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$3.75</td></tr>
        <tr class="g"><td>Total</td><td class="r">$78.75</td></tr>
      </table>
      <div class="tender">DEBIT ************2210 &nbsp; APPROVED</div>`),
  },

  {
    id: "expense-unknown-supplier",
    note: "A supplier who is NOT in the books — the matcher must refuse, not invent one.",
    truth: {
      direction: "expense",
      partyId: null,
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 42,
      documentNumber: "8812",
      documentDate: "2026-06-14",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>Kildonan Print &amp; Copy</h1>
        <p class="muted">88 Henderson Hwy, Winnipeg MB<br/>GST 74112 8890 RT0001</p></div>
        <div class="kind">Receipt</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>June 14, 2026</div>
        <div><div class="lbl">No.</div>8812</div></div>
      <table><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Colour printing — 400 pages</td><td class="r">$40.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$40.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$2.00</td></tr>
        <tr class="g"><td>Total</td><td class="r">$42.00</td></tr>
      </table>
      <div class="tender">MASTERCARD ************0031 &nbsp; APPROVED</div>`),
  },

  {
    id: "sales-invoice-two-products",
    note: "Two DIFFERENT products on one invoice — a single-line post can only carry one, so this should not be confidently auto-matched.",
    truth: {
      direction: "income",
      partyId: "con-eastside",
      itemId: null, // genuinely ambiguous: two products, one line posted
      taxCodeId: "CAN-GST-SALES",
      total: 5250,
      documentNumber: "INV-2048",
      documentDate: "2026-07-25",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>ABC Incorporation Inc.</h1>
        <p class="muted">GST/HST 81234 5678 RT0001</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta">
        <div><div class="lbl">Bill to</div><strong>Eastside Club</strong></div>
        <div><div class="lbl">Invoice no.</div>INV-2048<br/>
          <div class="lbl" style="margin-top:8px">Date</div>July 25, 2026<br/>
          <div class="lbl" style="margin-top:8px">Terms</div>Net 30</div></div>
      <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Development work - developer onsite per day<div class="sub">3 days on site</div></td><td class="r">$3,000.00</td></tr>
        <tr><td>Project management &amp; implementation - branding</td><td class="r">$2,000.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$5,000.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$250.00</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$5,250.00</td></tr>
      </table>
      <div class="pay"><strong>Remit to ABC Incorporation Inc.</strong></div>`),
  },

  // ── Capture quality: the same job, through a worse lens ────────────────────

  {
    id: "expense-thermal-fuel",
    note: "Faded thermal till roll, monospace, paid at the pump. Low-contrast ink is the commonest reason a total comes back wrong.",
    capture: "thermal",
    truth: {
      direction: "expense",
      partyId: "con-petro",
      accountId: "acc-449", // fuel is unambiguously motor vehicle
      taxCodeId: "CAN-GST",
      total: 71.4,
      documentNumber: "0417822",
      documentDate: "2026-06-03",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div style="text-align:center"><h1>PETRO-CANADA</h1>
        <p class="muted">SITE 04178 &middot; PORTAGE AVE<br/>WINNIPEG MB &middot; GST 82910 4471 RT0001</p></div>
      <hr/>
      <div class="meta"><div><div class="lbl">DATE</div>03/06/2026 07:41</div>
        <div><div class="lbl">TRANS</div>0417822</div></div>
      <table><tbody>
        <tr><td>UNLEADED 87<div class="sub">48.21 L @ 1.410/L</div></td><td class="r">$68.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>SUBTOTAL</td><td class="r">$68.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$3.40</td></tr>
        <tr class="g"><td>TOTAL</td><td class="r">$71.40</td></tr>
      </table>
      <div class="tender">DEBIT ****8891 &nbsp; APPROVED<br/>PUMP 04 &nbsp; THANK YOU</div>`),
  },

  {
    id: "expense-photo-angled",
    note: "Supplier bill photographed on a desk at an angle, half in shadow. How most documents actually arrive.",
    capture: "photo",
    truth: {
      direction: "expense",
      partyId: "con-hd",
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 342.09,
      documentNumber: "HD-558210",
      documentDate: "2026-06-18",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>THE HOME DEPOT</h1>
        <p class="muted">Pro Account &middot; 1245 St James St, Winnipeg MB<br/>GST/HST 10001 2345 RT0001</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta"><div><div class="lbl">Invoice date</div>June 18, 2026</div>
        <div><div class="lbl">Invoice #</div>HD-558210</div>
        <div><div class="lbl">Terms</div>Net 30</div></div>
      <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Pressure-treated 2x4x8</td><td class="r">24</td><td class="r">$191.76</td></tr>
        <tr><td>Exterior deck screws, 5 lb</td><td class="r">2</td><td class="r">$134.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$325.76</td></tr>
        <tr><td>GST 5%</td><td class="r">$16.29</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$342.09</td></tr>
      </table>
      <div class="pay"><strong>Balance outstanding.</strong> Payable to The Home Depot Canada.</div>`),
  },

  {
    id: "expense-photo-tip-trap",
    note: "Restaurant bill with a TIP: the total is NOT subtotal + tax. Reading the pre-tip figure understates the expense on every meal a firm ever books.",
    capture: "photo",
    truth: {
      direction: "expense",
      partyId: "con-boreal",
      accountId: "acc-420", // meals -> Entertainment
      taxCodeId: "CAN-GST",
      total: 98.0,
      documentNumber: "T-2291",
      documentDate: "2026-06-25",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div style="text-align:center"><h1>Bor&eacute;al Traiteur &amp; &Eacute;v&eacute;nements</h1>
        <p class="muted">318 Provencher Blvd, Winnipeg MB &middot; GST 71120 8823 RT0001</p></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>June 25, 2026 19:48</div>
        <div><div class="lbl">Table / Chk</div>T-2291</div></div>
      <table><tbody>
        <tr><td>Prix fixe dinner &times; 3</td><td class="r">$76.50</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$76.50</td></tr>
        <tr><td>GST 5%</td><td class="r">$3.83</td></tr>
        <tr><td>Tip</td><td class="r">$17.67</td></tr>
        <tr class="g"><td>Total charged</td><td class="r">$98.00</td></tr>
      </table>
      <div class="tender"><strong>MASTERCARD ****3310</strong> &nbsp; APPROVED &nbsp; $98.00</div>`),
  },

  {
    id: "expense-photocopy-faded",
    note: "Photocopy of a fax of a scan, skewed by the feeder. Rare, but it is still what 'we'll send it over' means at some firms.",
    capture: "faded",
    truth: {
      direction: "expense",
      partyId: "con-bell",
      accountId: "acc-453",
      taxCodeId: "CAN-GST",
      total: 214.62,
      documentNumber: "8829174-JUN",
      documentDate: "2026-06-01",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>BELL CANADA</h1>
        <p class="muted">Business Services &middot; GST 10063 4571 RT0001</p></div>
        <div class="kind">Statement</div></div><hr/>
      <div class="meta"><div><div class="lbl">Bill date</div>June 1, 2026</div>
        <div><div class="lbl">Account</div>8829174-JUN</div>
        <div><div class="lbl">Due</div>June 26, 2026</div></div>
      <table><thead><tr><th>Service</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Business fibre internet 1.5 Gbps</td><td class="r">$129.95</td></tr>
        <tr><td>Business phone line &times; 2</td><td class="r">$74.50</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$204.45</td></tr>
        <tr><td>GST 5%</td><td class="r">$10.22</td></tr>
        <tr class="g"><td>Amount due</td><td class="r">$214.62</td></tr>
      </table>
      <div class="pay">Please pay by the due date. Do not remit cash.</div>`),
  },

  // ── Tax shapes across Canada ───────────────────────────────────────────────

  {
    id: "expense-manitoba-two-taxes",
    note: "Manitoba GST 5% + RST 7% as separate lines. RST was missing from the tax vocabulary until this harness found it.",
    capture: "clean",
    truth: {
      direction: "expense",
      partyId: "con-hd",
      accountId: null,
      taxCodeId: "CAN-GSTRST",
      total: 247.83,
      documentNumber: "SC-884120",
      documentDate: "2026-06-11",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>THE HOME DEPOT</h1>
        <p class="muted">1245 St James St, Winnipeg MB<br/>GST 10001 2345 RT0001 &middot; MB RST 123456-7</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>June 11, 2026</div>
        <div><div class="lbl">Invoice #</div>SC-884120</div>
        <div><div class="lbl">Terms</div>Net 30</div></div>
      <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Shop vacuum 12 gal</td><td class="r">1</td><td class="r">$221.28</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$221.28</td></tr>
        <tr><td>GST 5%</td><td class="r">$11.06</td></tr>
        <tr><td>MB RST 7%</td><td class="r">$15.49</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$247.83</td></tr>
      </table>
      <div class="pay"><strong>Balance outstanding.</strong> Net 30.</div>`),
  },

  {
    id: "expense-ontario-hst",
    note: "Ontario HST 13% as a single combined line, photographed. One tax line, not two.",
    capture: "photo",
    truth: {
      direction: "expense",
      partyId: null, // Bytown Print is not in the books
      accountId: null,
      taxCodeId: "CAN-HST",
      total: 384.2,
      documentNumber: "BP-11402",
      documentDate: "2026-05-29",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>Bytown Print Co.</h1>
        <p class="muted">88 Rideau St, Ottawa ON &middot; HST 84420 1190 RT0001</p></div>
        <div class="kind">Receipt</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>May 29, 2026</div>
        <div><div class="lbl">Order</div>BP-11402</div></div>
      <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Brochures, 500 &times; full colour</td><td class="r">$340.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$340.00</td></tr>
        <tr><td>HST 13%</td><td class="r">$44.20</td></tr>
        <tr class="g"><td>Total</td><td class="r">$384.20</td></tr>
      </table>
      <div class="tender"><strong>VISA ****0071</strong> &nbsp; APPROVED &nbsp; PAID IN FULL</div>`),
  },

  {
    id: "expense-zero-rated-no-tax",
    note: "Basic groceries: zero-rated, so subtotal equals total and there is NO tax line. Must not invent one.",
    capture: "thermal",
    truth: {
      direction: "expense",
      partyId: null,
      accountId: null,
      taxCodeId: null, // no tax on the document -> nothing to match
      total: 43.17,
      documentNumber: "1180-4471",
      documentDate: "2026-06-08",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div style="text-align:center"><h1>SOBEYS</h1>
        <p class="muted">STORE 1180 &middot; GRANT AVE, WINNIPEG MB</p></div><hr/>
      <div class="meta"><div><div class="lbl">DATE</div>08/06/2026 11:02</div>
        <div><div class="lbl">REF</div>1180-4471</div></div>
      <table><tbody>
        <tr><td>MILK 4L 2%</td><td class="r">$6.49</td></tr>
        <tr><td>BREAD WHOLE WHEAT &times;2</td><td class="r">$7.98</td></tr>
        <tr><td>COFFEE GROUND 930G</td><td class="r">$18.99</td></tr>
        <tr><td>BANANAS 2.14 KG</td><td class="r">$3.62</td></tr>
        <tr><td>EGGS LARGE DOZ &times;2</td><td class="r">$6.09</td></tr>
      </tbody></table>
      <table class="tot">
        <tr class="g"><td>TOTAL</td><td class="r">$43.17</td></tr>
      </table>
      <div class="tender">DEBIT ****2210 &nbsp; APPROVED &nbsp; $43.17</div>`),
  },

  // ── Number traps ───────────────────────────────────────────────────────────

  {
    id: "expense-cash-rounding-change",
    note: "Cash sale: AMOUNT TENDERED and CHANGE both appear as larger, later numbers than the total. Picking either books the wrong figure.",
    capture: "thermal",
    truth: {
      direction: "expense",
      partyId: null,
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 26.25,
      documentNumber: "0091-338",
      documentDate: "2026-06-14",
      paid: true,
      hasLineItems: true,
    },
    html: page(`
      <div style="text-align:center"><h1>NORWOOD HARDWARE</h1>
        <p class="muted">GST 88210 4417 RT0001</p></div><hr/>
      <div class="meta"><div><div class="lbl">DATE</div>14/06/2026</div>
        <div><div class="lbl">TXN</div>0091-338</div></div>
      <table><tbody>
        <tr><td>KEYS CUT &times;3</td><td class="r">$12.00</td></tr>
        <tr><td>PADLOCK 40MM</td><td class="r">$13.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>SUBTOTAL</td><td class="r">$25.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$1.25</td></tr>
        <tr class="g"><td>TOTAL</td><td class="r">$26.25</td></tr>
        <tr><td>CASH TENDERED</td><td class="r">$40.00</td></tr>
        <tr><td>CHANGE</td><td class="r">$13.75</td></tr>
      </table>
      <div class="tender">PAID CASH &nbsp; NO REFUNDS WITHOUT RECEIPT</div>`),
  },

  {
    id: "expense-discount-before-tax",
    note: "A discount line between subtotal and tax. The gross figure is the loudest number on the page and it is not what should be booked.",
    capture: "clean",
    truth: {
      direction: "expense",
      partyId: "con-bell",
      accountId: "acc-453",
      taxCodeId: "CAN-GST",
      total: 141.75,
      documentNumber: "INV-77301",
      documentDate: "2026-06-20",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>BELL CANADA</h1>
        <p class="muted">Business Services &middot; GST 10063 4571 RT0001</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta"><div><div class="lbl">Invoice date</div>June 20, 2026</div>
        <div><div class="lbl">Invoice #</div>INV-77301</div>
        <div><div class="lbl">Terms</div>Net 15</div></div>
      <table><thead><tr><th>Service</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Mobility &mdash; 3 lines</td><td class="r">$180.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$180.00</td></tr>
        <tr><td>Loyalty credit &mdash; 25%</td><td class="r">-$45.00</td></tr>
        <tr><td>Net</td><td class="r">$135.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$6.75</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$141.75</td></tr>
      </table>
      <div class="pay"><strong>Balance outstanding.</strong></div>`),
  },

  {
    id: "expense-due-date-louder",
    note: "The DUE date is set larger and later than the invoice date. Posting on the due date puts the expense in the wrong period.",
    capture: "photo",
    truth: {
      direction: "expense",
      partyId: "con-boreal",
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 630.0,
      documentNumber: "BT-4419",
      documentDate: "2026-06-26", // NOT the 2026-07-26 due date
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>Bor&eacute;al Traiteur &amp; &Eacute;v&eacute;nements</h1>
        <p class="muted">318 Provencher Blvd, Winnipeg MB &middot; GST 71120 8823 RT0001</p></div>
        <div style="text-align:right"><div class="lbl">Payment due</div>
          <div style="font-size:27px;font-weight:800;color:#b3261e">July 26, 2026</div></div></div><hr/>
      <div class="meta"><div><div class="lbl">Invoice date</div>June 26, 2026</div>
        <div><div class="lbl">Invoice #</div>BT-4419</div></div>
      <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Staff appreciation lunch, 30 covers</td><td class="r">$600.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$600.00</td></tr>
        <tr><td>GST 5%</td><td class="r">$30.00</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$630.00</td></tr>
      </table>
      <div class="pay">Net 30 from invoice date.</div>`),
  },

  {
    id: "expense-long-itemised",
    note: "Sixteen lines and a grand total at the bottom. Tests finding the total among many plausible numbers.",
    capture: "clean",
    truth: {
      direction: "expense",
      partyId: "con-hd",
      accountId: null,
      taxCodeId: "CAN-GST",
      total: 1289.66,
      documentNumber: "HD-903318",
      documentDate: "2026-06-05",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>THE HOME DEPOT</h1>
        <p class="muted">Pro Desk &middot; GST/HST 10001 2345 RT0001</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>June 5, 2026</div>
        <div><div class="lbl">Invoice #</div>HD-903318</div>
        <div><div class="lbl">Terms</div>Net 30</div></div>
      <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Plywood sheathing 15/32"</td><td class="r">18</td><td class="r">$412.02</td></tr>
        <tr><td>Framing nails 3-1/4" 5000ct</td><td class="r">2</td><td class="r">$118.00</td></tr>
        <tr><td>House wrap 9' &times; 150'</td><td class="r">1</td><td class="r">$139.00</td></tr>
        <tr><td>Construction adhesive</td><td class="r">12</td><td class="r">$83.88</td></tr>
        <tr><td>Utility knife blades 100ct</td><td class="r">1</td><td class="r">$21.99</td></tr>
        <tr><td>Chalk line refill</td><td class="r">3</td><td class="r">$17.97</td></tr>
        <tr><td>Tarp 20' &times; 30'</td><td class="r">2</td><td class="r">$79.98</td></tr>
        <tr><td>Shop rags 50 pack</td><td class="r">1</td><td class="r">$18.99</td></tr>
        <tr><td>Caulk, exterior</td><td class="r">8</td><td class="r">$63.92</td></tr>
        <tr><td>Sandpaper assortment</td><td class="r">4</td><td class="r">$35.96</td></tr>
        <tr><td>Safety glasses</td><td class="r">6</td><td class="r">$47.94</td></tr>
        <tr><td>Work gloves, XL</td><td class="r">6</td><td class="r">$71.94</td></tr>
        <tr><td>Extension cord 50'</td><td class="r">2</td><td class="r">$97.98</td></tr>
        <tr><td>Drop cloth canvas</td><td class="r">3</td><td class="r">$56.97</td></tr>
        <tr><td>Screws, deck 3" 5lb</td><td class="r">2</td><td class="r">$134.00</td></tr>
        <tr><td>Pencils, carpenter 12ct</td><td class="r">1</td><td class="r">$7.99</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">$1,228.25</td></tr>
        <tr><td>GST 5%</td><td class="r">$61.41</td></tr>
        <tr class="g"><td>Total due</td><td class="r">$1,289.66</td></tr>
      </table>
      <div class="pay"><strong>Balance outstanding.</strong></div>`),
  },

  // ── Currency (guards the work that made non-CAD documents postable) ────────

  {
    id: "expense-usd-stated",
    note: "A US-dollar invoice that says so in words and a code. Reading the currency is what decides whether the books get the right money.",
    capture: "clean",
    truth: {
      direction: "expense",
      partyId: null,
      accountId: null,
      taxCodeId: null,
      total: 540.0,
      documentNumber: "AWS-2026-06",
      documentDate: "2026-06-30",
      paid: true,
      hasLineItems: true,
      currency: "USD",
    },
    html: page(`
      <div class="hd"><div><h1>Northwind Cloud Services</h1>
        <p class="muted">1200 12th Ave S, Seattle WA 98144, USA</p></div>
        <div class="kind">Invoice</div></div><hr/>
      <div class="meta"><div><div class="lbl">Invoice date</div>June 30, 2026</div>
        <div><div class="lbl">Invoice #</div>AWS-2026-06</div>
        <div><div class="lbl">Currency</div>USD</div></div>
      <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr><td>Compute &amp; storage, June 2026</td><td class="r">US$540.00</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">US$540.00</td></tr>
        <tr><td>Tax</td><td class="r">US$0.00</td></tr>
        <tr class="g"><td>Total (USD)</td><td class="r">US$540.00</td></tr>
      </table>
      <div class="tender"><strong>Charged to card ****4412.</strong> All amounts in United States dollars (USD).</div>`),
  },

  // ── Income shapes ──────────────────────────────────────────────────────────

  {
    id: "sales-invoice-french-deposit",
    note: "French sales invoice asking for a 50% deposit: partly-paid language must not read as settled in full.",
    capture: "clean",
    truth: {
      direction: "income",
      partyId: "con-eastside",
      itemId: null, // "honoraires professionnels" matches no product in the books
      taxCodeId: "CAN-GSTQST-SALES",
      total: 4599.0,
      documentNumber: "F-2026-118",
      documentDate: "2026-06-22",
      paid: false,
      hasLineItems: true,
    },
    html: page(`
      <div class="hd"><div><h1>ABC Incorporation Inc.</h1>
        <p class="muted">TPS 81102 4471 RT0001 &middot; TVQ 1029384756 TQ0001</p></div>
        <div class="kind">Facture</div></div><hr/>
      <div class="meta"><div><div class="lbl">Date</div>22 juin 2026</div>
        <div><div class="lbl">Facture n&deg;</div>F-2026-118</div>
        <div><div class="lbl">Client</div>Eastside Club</div></div>
      <table><thead><tr><th>Description</th><th class="r">Montant</th></tr></thead>
      <tbody>
        <tr><td>Honoraires professionnels &mdash; mandat de v&eacute;rification</td><td class="r">4 000,00 $</td></tr>
      </tbody></table>
      <table class="tot">
        <tr><td>Sous-total</td><td class="r">4 000,00 $</td></tr>
        <tr><td>TPS 5 %</td><td class="r">200,00 $</td></tr>
        <tr><td>TVQ 9,975 %</td><td class="r">399,00 $</td></tr>
        <tr class="g"><td>Total</td><td class="r">4 599,00 $</td></tr>
      </table>
      <div class="pay"><strong>Un acompte de 50 % est exigible &agrave; la signature.</strong>
        Solde payable &agrave; la livraison. Aucun paiement re&ccedil;u &agrave; ce jour.</div>`),
  },

  // ── Documents that are NOT transactions ───────────────────────────────────

  {
    id: "not-a-txn-business-card",
    note: "A business card with a phone number on it. Inventing a total here puts a number in a client's books with no document behind it.",
    capture: "photo",
    expectNoTransaction: true,
    html: page(`
      <div style="padding:80px 40px;text-align:center">
        <h1 style="font-size:26px">Marchand &amp; Fils</h1>
        <p class="muted" style="font-size:14px;margin-top:8px">Plomberie &middot; Chauffage &middot; Depuis 1974</p>
        <p style="margin-top:34px;font-size:15px">Yves Marchand<br/><span class="muted">Ma&icirc;tre plombier</span></p>
        <p style="margin-top:26px;font-size:14px">204 555 0147<br/>yves@marchandetfils.ca<br/>
          770 Rue Des Meurons, Winnipeg MB R2H 2P9</p>
        <p class="muted" style="margin-top:30px">Licence 4471-2 &middot; RBQ 8821-9910-04</p>
      </div>`),
  },

  {
    id: "not-a-txn-bank-statement",
    note: "A bank statement page: many transactions, an opening and a closing balance, no single amount owed. Must not be booked as one bill.",
    capture: "clean",
    expectNoTransaction: true,
    html: page(`
      <div class="hd"><div><h1>RIDGEWAY BANK</h1>
        <p class="muted">Business Chequing &middot; 04471-882-9</p></div>
        <div class="kind">Statement</div></div><hr/>
      <div class="meta"><div><div class="lbl">Period</div>June 1 &ndash; June 30, 2026</div>
        <div><div class="lbl">Opening</div>$12,884.10</div>
        <div><div class="lbl">Closing</div>$9,431.77</div></div>
      <table><thead><tr><th>Date</th><th>Description</th><th class="r">Out</th><th class="r">In</th><th class="r">Balance</th></tr></thead>
      <tbody>
        <tr><td>Jun 03</td><td>PETRO-CANADA 04178</td><td class="r">71.40</td><td class="r"></td><td class="r">12,812.70</td></tr>
        <tr><td>Jun 05</td><td>HOME DEPOT PRO</td><td class="r">1,289.66</td><td class="r"></td><td class="r">11,523.04</td></tr>
        <tr><td>Jun 09</td><td>DEPOSIT &mdash; EASTSIDE CLUB</td><td class="r"></td><td class="r">3,400.00</td><td class="r">14,923.04</td></tr>
        <tr><td>Jun 14</td><td>NORWOOD HARDWARE</td><td class="r">26.25</td><td class="r"></td><td class="r">14,896.79</td></tr>
        <tr><td>Jun 20</td><td>BELL CANADA PREAUTH</td><td class="r">214.62</td><td class="r"></td><td class="r">14,682.17</td></tr>
        <tr><td>Jun 25</td><td>BOREAL TRAITEUR</td><td class="r">98.00</td><td class="r"></td><td class="r">14,584.17</td></tr>
        <tr><td>Jun 26</td><td>PAYROLL</td><td class="r">5,152.40</td><td class="r"></td><td class="r">9,431.77</td></tr>
      </tbody></table>
      <div class="pay">Service charges for the period: $14.50. Please review and report discrepancies within 30 days.</div>`),
  },
];
