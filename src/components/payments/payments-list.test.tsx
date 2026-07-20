import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { PaymentsList } from "./payments-list";
import type { PaymentsListRow } from "@/lib/db/payment-requests";

afterEach(() => cleanup());

const ROW: PaymentsListRow = {
  id: "p1",
  status: "paid",
  amountCents: 35000,
  currency: "cad",
  createdAt: "2026-06-19T00:00:00.000Z",
  clientName: "Tyler Jette",
  engagementTitle: "2025 return",
  requestedByUserId: null,
  requestedByName: null,
  invoiceNumber: null,
  invoiceKind: null,
};

function renderList(rows: PaymentsListRow[], currentUserId?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PaymentsList rows={rows} currentUserId={currentUserId} />
    </NextIntlClientProvider>,
  );
}

describe("PaymentsList", () => {
  it("renders a row with the engagement, amount, and a Paid badge", () => {
    renderList([ROW]);
    expect(screen.getByText("2025 return")).toBeInTheDocument();
    expect(screen.getByText(/\$350\.00/)).toBeInTheDocument();
    expect(screen.getByText(en.Engagements.pay_badge_paid)).toBeInTheDocument();
  });

  it("shows the empty state when there are no payments", () => {
    renderList([]);
    expect(
      screen.getByText(en.Engagements.payments_list_empty),
    ).toBeInTheDocument();
  });

  it("tags an invoice sent by a teammate (not the viewer)", () => {
    renderList(
      [{ ...ROW, requestedByUserId: "u-marie", requestedByName: "Marie" }],
      "u-me",
    );
    expect(screen.getByText(/Sent by Marie/)).toBeInTheDocument();
  });

  it("does NOT tag an invoice the viewer sent themselves", () => {
    renderList(
      [{ ...ROW, requestedByUserId: "u-me", requestedByName: "Me" }],
      "u-me",
    );
    expect(screen.queryByText(/Sent by/)).not.toBeInTheDocument();
  });

  it("does NOT tag when there is no requester name", () => {
    renderList([{ ...ROW, requestedByUserId: null, requestedByName: null }], "u-me");
    expect(screen.queryByText(/Sent by/)).not.toBeInTheDocument();
  });
});
