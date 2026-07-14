import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PortalFooter } from "./portal-footer";
import en from "../../../messages/en.json";

function renderFooter(props: {
  email: string | null;
  subject: string;
  body: string;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PortalFooter {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PortalFooter", () => {
  it("opens a picker whose Gmail / Outlook / mail-app links all carry recipient + subject + body", () => {
    const email = "alex@cabinet.ca";
    const subject = "Cabinet — Tax 2025";
    const body = "Hi,\n\nA question.\n\nThanks.";
    renderFooter({ email, subject, body });

    // The address stays visible as a universal fallback (webmail / no mail client).
    expect(screen.getByText(email)).toBeInTheDocument();
    // And a copy affordance exists for clients whose browser ignores mailto:.
    expect(
      screen.getByRole("button", { name: en.Portal.help_copy }),
    ).toBeInTheDocument();

    // The picker is collapsed until the trigger is clicked.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: en.Portal.help_message }),
    );

    const eSubject = encodeURIComponent(subject);
    const eBody = encodeURIComponent(body);
    const eEmail = encodeURIComponent(email);

    // Gmail: an https compose tab that works on any OS — this is the Windows fix.
    const gmail = screen.getByRole("menuitem", { name: "Gmail" });
    const gmailHref = gmail.getAttribute("href") ?? "";
    expect(gmailHref).toContain("https://mail.google.com/mail/");
    expect(gmailHref).toContain(`to=${eEmail}`);
    expect(gmailHref).toContain(`su=${eSubject}`);
    expect(gmailHref).toContain(`body=${eBody}`);
    expect(gmail).toHaveAttribute("target", "_blank");

    // Outlook: same idea for Office / Outlook webmail users.
    const outlook = screen.getByRole("menuitem", { name: "Outlook" });
    const outlookHref = outlook.getAttribute("href") ?? "";
    expect(outlookHref).toContain(
      "https://outlook.office.com/mail/deeplink/compose",
    );
    expect(outlookHref).toContain(`to=${eEmail}`);
    expect(outlookHref).toContain(`subject=${eSubject}`);
    expect(outlookHref).toContain(`body=${eBody}`);
    expect(outlook).toHaveAttribute("target", "_blank");

    // Desktop mail app: the mailto MUST carry the recipient (the original regression).
    const mailApp = screen.getByRole("menuitem", {
      name: en.Portal.help_email_app,
    });
    const mailtoHref = mailApp.getAttribute("href") ?? "";
    expect(mailtoHref).toContain(`mailto:${email}`);
    expect(mailtoHref).toContain(`subject=${eSubject}`);
    expect(mailtoHref).toContain(`body=${eBody}`);
  });

  it("hides the whole help block (button, email, copy) when the portal has a Messages entry", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PortalFooter
          email="alex@cabinet.ca"
          subject="s"
          body="b"
          showHelp={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("alex@cabinet.ca")).not.toBeInTheDocument();
    expect(screen.queryByText(en.Portal.help_intro)).not.toBeInTheDocument();
    // The footer itself stays (Powered by Vylan).
    expect(screen.getByText(en.Portal.powered_by)).toBeInTheDocument();
  });

  it("falls back to a plain instruction (no links, no buttons) when no email is on file", () => {
    renderFooter({ email: null, subject: "x", body: "y" });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(en.Portal.help_no_email)).toBeInTheDocument();
  });
});
