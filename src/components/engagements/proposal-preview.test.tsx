import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  ProposalPreview,
  type ProposalPreviewData,
} from "./proposal-preview";
import en from "../../../messages/en.json";

// The client's proposal can only be seen with a live magic token, so this
// stands in for eyes-on. The founder's complaint was that the document "looks
// horrible" and "should look official" — most of what makes it official is
// structural (a letterhead with a sender, numbered sections, numbered clauses,
// a real amount column, an acceptance statement), and structure is exactly what
// a render test can hold onto.
//
// It also catches the failure this repo keeps paying for: a wrong next-intl key
// renders as the literal string `Templates.foo` ON SCREEN while passing tsc,
// eslint and the build. Every assertion below reads visible text, so a bad key
// fails here instead of in front of a client.

afterEach(cleanup);

const base: ProposalPreviewData = {
  clientName: "Marie Tremblay",
  engagementName: "2026 Corporate Tax Return",
  periodStartsOn: "acceptance",
  periodMonths: null,
  welcome: "Looking forward to working together this year.",
  videoUrl: null,
  documentName: null,
  firmName: "Cabinet Tremblay & Associés",
  brandColor: "#1d4ed8",
  sentDate: "2026-08-06",
  services: [
    {
      name: "T2 Corporate Return Preparation",
      rateCents: 400_000,
      billingFrequency: "once",
      taxPct: 0,
      work: ["Prepare the T2", "File with CRA"],
    },
    {
      name: "Monthly bookkeeping",
      rateCents: 50_000,
      billingFrequency: "monthly",
      taxPct: 0,
    },
  ],
  termsSections: [
    { heading: "Scope of work", body: "We prepare and file the returns listed above." },
    { heading: "Fees", body: "Fees are payable on the terms stated in this letter." },
  ],
  depositCents: null,
};

function renderDoc(over: Partial<ProposalPreviewData> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProposalPreview
        data={{ ...base, ...over }}
        locale="en"
        variant="document"
      />
    </NextIntlClientProvider>,
  );
}

describe("the proposal reads as a document, not an app screen", () => {
  it("carries a letterhead: who sent it, and when", () => {
    renderDoc();
    // Without a sender the page opened straight into a title with nothing
    // identifying who wrote it — most of why it read as a dashboard.
    // Appears twice on purpose: the letterhead at the top, and "Prepared by"
    // in the acceptance block. That is what a letter does.
    expect(screen.getAllByText("Cabinet Tremblay & Associés").length).toBeGreaterThan(0);
    expect(screen.getByText(/August 6, 2026/)).toBeTruthy();
    expect(screen.getByText(/Engagement letter/i)).toBeTruthy();
  });

  it("addresses the client and states the period", () => {
    renderDoc();
    expect(screen.getByText("Prepared for")).toBeTruthy();
    // Twice, deliberately: addressed-to at the top, accepted-by at the foot.
    expect(screen.getAllByText("Marie Tremblay").length).toBeGreaterThan(0);
    expect(screen.getByText("Engagement period")).toBeTruthy();
  });

  it("numbers its sections", () => {
    renderDoc();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "1. Introduction",
      "2. Services and fees",
      "3. Terms of engagement",
      "4. Acceptance",
    ]);
  });

  it("renumbers when there is no introduction rather than skipping 1", () => {
    // A contract that jumps from 1 to 3 is a contract nobody proofread.
    renderDoc({ welcome: null, videoUrl: null, documentName: null });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "1. Services and fees",
      "2. Terms of engagement",
      "3. Acceptance",
    ]);
  });

  it("numbers the terms clauses under their section", () => {
    renderDoc();
    expect(screen.getByText("3.1 Scope of work")).toBeTruthy();
    expect(screen.getByText("3.2 Fees")).toBeTruthy();
  });

  it("prices in a real table with an amount column", () => {
    renderDoc();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Service")).toBeTruthy();
    expect(within(table).getByText("Amount")).toBeTruthy();
    expect(within(table).getByText("T2 Corporate Return Preparation")).toBeTruthy();
    expect(within(table).getByText("$4,000.00")).toBeTruthy();
    // The work each line buys, so the client reads what they are buying.
    expect(within(table).getByText("File with CRA")).toBeTruthy();
  });

  it("says what accepting actually commits them to", () => {
    renderDoc();
    // The page used to draw signature lines and never state what clicking
    // Accept meant. This sentence IS the acceptance instrument.
    expect(
      screen.getByText(/agrees to the services, fees and terms set out in this letter/i),
    ).toBeTruthy();
    expect(screen.getByText("Accepted by")).toBeTruthy();
    expect(screen.getByText("Prepared by")).toBeTruthy();
  });

  it("shows an unpriced line as words, never a bare dash", () => {
    // A dash in an amount column reads as zero, and zero means free.
    renderDoc({
      services: [
        { name: "Advisory", rateCents: null, billingFrequency: "once", taxPct: 0 },
      ],
    });
    // Once in the amount column, once in the totals panel — both correct.
    expect(screen.getAllByText(/Determined later/i).length).toBeGreaterThan(0);
  });

  it("never truncates a service name — a contract says what it says", () => {
    const long =
      "Preparation and filing of the corporate income tax return including all schedules";
    renderDoc({
      services: [
        { name: long, rateCents: 100_000, billingFrequency: "once", taxPct: 0 },
      ],
    });
    const cell = screen.getByText(long);
    expect(cell.className).not.toMatch(/truncate/);
  });

  it("renders no raw translation keys anywhere", () => {
    // The failure mode that passes every other check in this repo.
    const { container } = renderDoc();
    expect(container.textContent ?? "").not.toMatch(
      /\b(Templates|Portal|Engagements)\.[a-z0-9_]+/,
    );
  });
});

describe("the firm's side-pane preview stays a thumbnail", () => {
  function renderPreview() {
    return render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProposalPreview data={base} locale="en" variant="preview" />
      </NextIntlClientProvider>,
    );
  }

  it("keeps the step rail, which orients the FIRM against its tabs", () => {
    renderPreview();
    expect(screen.getByText("Introduction")).toBeTruthy();
    // "Acceptance", not "Sign" — the rail was the last place on screen where
    // the removed signing ceremony was still named.
    expect(screen.getAllByText("Acceptance").length).toBeGreaterThan(0);
  });

  it("does NOT show the step rail on the client's copy", () => {
    // Four numbered circles announcing "step 4 of 4" over a contract whose
    // sections are all visible at once is app furniture. The document has one
    // "Acceptance" — its section heading — and not the rail's second copy.
    renderDoc();
    expect(screen.getAllByText(/Acceptance/).length).toBe(1);
  });

  it("renders the same document structure in both variants", () => {
    // The whole reason this is one component with a prop: a preview that shows
    // something different from the client's copy is not a preview.
    renderPreview();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "1. Introduction",
      "2. Services and fees",
      "3. Terms of engagement",
      "4. Acceptance",
    ]);
  });
});

describe("nobody signs a contract that is accepted, not signed", () => {
  // Founder: "just get rid of signing in general for the contract. It'll be
  // simpler... make more sense probably." Right — accepting and paying IS the
  // act (Ignition's model), so drawing rules under two names implied a ceremony
  // that never happens.

  it("still names both parties", () => {
    renderDoc();
    expect(screen.getByText("Accepted by")).toBeTruthy();
    expect(screen.getByText("Prepared by")).toBeTruthy();
  });

  it("draws no signature rules under them", () => {
    const { container } = renderDoc();
    // The two rules lived as bare bordered divs directly under each name. If a
    // future change reintroduces a signature line, this is what catches it.
    const rules = container.querySelectorAll("div.border-t.border-foreground\\/25");
    expect(rules.length).toBe(0);
  });

  it("renders a proposal frozen BEFORE signing was removed", () => {
    // Those rows still carry clientSigns / additionalSignerLabels /
    // firmCountersigns. The reader keeps accepting them; nothing renders them.
    const { container } = renderDoc({
      clientSigns: true,
      additionalSignerLabels: ["Spouse", "Second director"],
      firmCountersigns: true,
    });
    expect(container.textContent).not.toMatch(/Second director/);
    expect(screen.getByText("Accepted by")).toBeTruthy();
  });
});

describe("the engagement period states the period and nothing else", () => {
  // Founder: "get rid of 'beginning when the client accepts'. keep just
  // 'Ongoing'." On the CLIENT's own copy that suffix addressed them in the
  // third person, and restated what the Acceptance section says properly.

  it('reads "Ongoing", not "Ongoing, beginning when the client accepts"', () => {
    renderDoc({ periodMonths: null, periodStartsOn: "acceptance" });
    expect(screen.getByText("Ongoing")).toBeTruthy();
    const { container } = renderDoc({ periodMonths: null });
    expect(container.textContent).not.toMatch(/beginning when the client accepts/i);
  });

  it("states a fixed term the same way", () => {
    renderDoc({ periodMonths: 12, periodStartsOn: "custom" });
    expect(screen.getByText("12 months")).toBeTruthy();
    const { container } = renderDoc({ periodMonths: 12, periodStartsOn: "custom" });
    expect(container.textContent).not.toMatch(/beginning on a date you pick/i);
  });
});
