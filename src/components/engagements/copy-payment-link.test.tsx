import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { CopyPaymentLink } from "./copy-payment-link";

afterEach(() => cleanup());

describe("CopyPaymentLink", () => {
  it("renders a copy button labeled Copy payment link", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CopyPaymentLink url="https://vylan.app/r/tok_test" />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("button", {
        name: new RegExp(en.Engagements.copy_payment_link),
      }),
    ).toBeInTheDocument();
  });
});
