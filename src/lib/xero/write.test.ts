import { describe, expect, it } from "vitest";
import { describeXeroFailure } from "./write";

// The body Xero actually returned when a payout journal was posted to a bank
// account. Note where ValidationErrors sits: AFTER the echoed document, which
// is why truncating the raw JSON used to throw away the only useful part.
const BANK_ACCOUNT_REJECTION = JSON.stringify({
  ErrorNumber: 10,
  Type: "ValidationException",
  Message: "A validation exception occurred",
  Elements: [
    {
      Date: "/Date(1782950400000+0000)/",
      Status: "POSTED",
      LineAmountTypes: "NoTax",
      ManualJournalID: "00000000-0000-0000-0000-000000000000",
      Narration: "Stripe payout 2026-06-01 to 2026-06-30",
      JournalLines: [{ LineAmount: 4781.43, AccountCode: "090" }],
      ValidationErrors: [
        {
          Message:
            "You cannot use a bank account in a manual journal. Account code: 090",
        },
      ],
    },
  ],
});

describe("describeXeroFailure", () => {
  it("pulls the validation message out from behind the echoed document", () => {
    expect(describeXeroFailure(BANK_ACCOUNT_REJECTION)).toBe(
      "You cannot use a bank account in a manual journal. Account code: 090",
    );
  });

  it("joins several distinct validation errors", () => {
    const body = JSON.stringify({
      Elements: [
        {
          ValidationErrors: [
            { Message: "Account code 090 is invalid" },
            { Message: "Journal must balance" },
          ],
        },
      ],
    });
    expect(describeXeroFailure(body)).toBe(
      "Account code 090 is invalid Journal must balance",
    );
  });

  it("says a repeated per-line error once", () => {
    // Xero repeats the same complaint on every offending line; three copies of
    // one sentence is noise, not information.
    const body = JSON.stringify({
      Elements: [
        { ValidationErrors: [{ Message: "Bank accounts are not allowed" }] },
        { ValidationErrors: [{ Message: "Bank accounts are not allowed" }] },
      ],
    });
    expect(describeXeroFailure(body)).toBe("Bank accounts are not allowed");
  });

  it("reads top-level ValidationErrors too", () => {
    const body = JSON.stringify({
      ValidationErrors: [{ Message: "Narration is required" }],
    });
    expect(describeXeroFailure(body)).toBe("Narration is required");
  });

  it("falls back to a top-level Detail for non-validation failures", () => {
    const body = JSON.stringify({
      Type: null,
      Title: "Unauthorized",
      Status: 401,
      Detail: "AuthenticationUnsuccessful",
    });
    expect(describeXeroFailure(body)).toBe("AuthenticationUnsuccessful");
  });

  it("refuses to return Xero's contentless wrapper sentence", () => {
    // "A validation exception occurred" tells the accountant nothing; the
    // caller is better off showing the raw body than pretending that's a reason.
    const body = JSON.stringify({
      ErrorNumber: 10,
      Type: "ValidationException",
      Message: "A validation exception occurred",
      Elements: [],
    });
    expect(describeXeroFailure(body)).toBeNull();
  });

  it("returns null for a non-JSON body so the caller can fall back", () => {
    expect(describeXeroFailure("<html>502 Bad Gateway</html>")).toBeNull();
    expect(describeXeroFailure("")).toBeNull();
    expect(describeXeroFailure("null")).toBeNull();
  });
});
