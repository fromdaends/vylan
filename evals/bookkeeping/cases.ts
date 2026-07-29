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
};

export type EvalCase = { id: string; note: string; html: string; truth: Truth };

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
  { id: "CAN-GSTRST-SALES", name: "GST/RST on Income", active: true, canApplyToRevenue: true, canApplyToExpenses: false },
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
];
