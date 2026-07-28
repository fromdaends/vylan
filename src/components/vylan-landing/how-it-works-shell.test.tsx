import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { HowItWorksShell } from "./how-it-works-shell";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

// happy-dom has no IntersectionObserver. The shell uses it only to fade blocks
// in on scroll; every assertion here is about content being IN the document,
// which the reveal never gates (elements render, then animate).
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// Built exactly the way the page builds it, from the real message catalogue,
// so a key renamed in one place and not the other fails here.
function strings(m: typeof en) {
  const t = m.VylanHowItWorks;
  return {
    heroEyebrow: t.hero_eyebrow,
    heroTitle: t.hero_title,
    heroSub: t.hero_sub,
    ctaBook: t.cta_book,
    ctaSeeHow: t.cta_see_how,
    problemEyebrow: t.problem_eyebrow,
    problemTitle: t.problem_title,
    problemChips: [
      t.problem_chip_1,
      t.problem_chip_2,
      t.problem_chip_3,
      t.problem_chip_4,
    ],
    problemBody: t.problem_body,
    stepsEyebrow: t.steps_eyebrow,
    stepsTitle: t.steps_title,
    steps: [
      { kicker: t.step1_kicker, title: t.step1_title, body: t.step1_body },
      { kicker: t.step2_kicker, title: t.step2_title, body: t.step2_body },
      { kicker: t.step3_kicker, title: t.step3_title, body: t.step3_body },
      { kicker: t.step4_kicker, title: t.step4_title, body: t.step4_body },
    ],
    workflow: {
      eyebrow: t.wa_eyebrow,
      title: t.wa_title,
      body: t.wa_body,
      panelLabel: t.wa_panel_label,
      play: t.wa_play,
      playing: t.wa_playing,
      replay: t.wa_replay,
      all: t.wa_all,
      moved: t.wa_moved,
      empty: t.wa_empty,
      foot: t.wa_foot,
      stageLabels: [
        m.Stage.stage_collecting,
        m.Stage.stage_in_review,
        m.Stage.stage_in_preparation,
        m.Stage.stage_awaiting_signature,
        m.Stage.stage_awaiting_payment,
        t.wa_paid,
      ],
      rows: [
        { name: t.wa_row1_name, sub: t.wa_row1_sub },
        { name: t.wa_row2_name, sub: t.wa_row2_sub },
        { name: t.wa_row3_name, sub: t.wa_row3_sub },
        { name: t.wa_row4_name, sub: t.wa_row4_sub },
      ],
    },
    integrationsLabel: t.integrations_label,
    integrationsHelp: t.integrations_help,
    filing: {
      eyebrow: t.filing_eyebrow,
      title: t.filing_title,
      body: t.filing_body,
      rules: [
        { title: t.filing_rule1_title, body: t.filing_rule1_body },
        { title: t.filing_rule2_title, body: t.filing_rule2_body },
        { title: t.filing_rule3_title, body: t.filing_rule3_body },
      ],
      treeYours: t.filing_tree_yours,
      treeNamed: t.filing_tree_named,
      folders: [
        t.filing_folder_1,
        t.filing_folder_2,
        t.filing_folder_3,
        t.filing_folder_4,
      ],
      fileName: t.filing_file_name,
      fileBadge: t.filing_file_badge,
      fileWas: t.filing_file_was,
      fileWasName: t.filing_file_was_name,
      into: t.filing_into,
      providers: [
        t.filing_provider_google,
        t.filing_provider_dropbox,
        t.filing_provider_microsoft,
      ],
    },
    payEyebrow: t.pay_eyebrow,
    payTitlePre: t.pay_title_pre,
    payTitleWord: t.pay_title_word,
    payBody: t.pay_body,
    paySteps: [
      { title: t.pay_step1_title, body: t.pay_step1_body },
      { title: t.pay_step2_title, body: t.pay_step2_body },
      { title: t.pay_step3_title, body: t.pay_step3_body },
    ],
    payStatBig: t.pay_stat_big,
    payStatUnit: t.pay_stat_unit,
    payStatTitle: t.pay_stat_title,
    payStatBody: t.pay_stat_body,
    payCaption: t.pay_caption,
    inv: {
      eyebrow: t.inv_eyebrow,
      title: t.inv_title,
      body: t.inv_body,
      mockNumber: t.inv_mock_number,
      mockFormat: t.inv_mock_format,
      lines: [
        { label: t.inv_mock_line1, amount: t.inv_mock_amt1 },
        { label: t.inv_mock_line2, amount: t.inv_mock_amt2 },
        { label: t.inv_mock_gst, amount: t.inv_mock_gst_amt, tax: true, auto: t.inv_mock_auto },
        { label: t.inv_mock_qst, amount: t.inv_mock_qst_amt, tax: true, auto: t.inv_mock_auto },
      ],
      totalLabel: t.inv_mock_total_label,
      total: t.inv_mock_total,
      foot: t.inv_mock_foot,
      directTitle: t.inv_direct_title,
      directBody: t.inv_direct_body,
    },
    trustEyebrow: t.trust_eyebrow,
    trustTitle: t.trust_title,
    trustIntro: t.trust_intro,
    trustCards: [
      { title: t.trust_1_title, body: t.trust_1_body, badge: t.trust_1_badge },
      { title: t.trust_2_title, body: t.trust_2_body, badge: t.trust_2_badge },
      { title: t.trust_3_title, body: t.trust_3_body },
      { title: t.trust_4_title, body: t.trust_4_body },
    ],
    closeTitle: t.close_title,
  };
}

const HELP = "/en/help";

describe("HowItWorksShell — auto-filing band", () => {
  it("renders the whole tree: every folder level, the renamed file, and the name it replaced", () => {
    render(<HowItWorksShell s={strings(en)} helpHref={HELP} />);
    const t = en.VylanHowItWorks;

    expect(screen.getByText(t.filing_title)).toBeTruthy();
    for (const folder of [
      t.filing_folder_1,
      t.filing_folder_2,
      t.filing_folder_3,
      t.filing_folder_4,
    ]) {
      expect(screen.getByText(folder)).toBeTruthy();
    }
    // The whole point of the section: the new name AND the old one, together.
    expect(screen.getByText(t.filing_file_name)).toBeTruthy();
    expect(screen.getByText(t.filing_file_was_name)).toBeTruthy();
    expect(screen.getByText(t.filing_file_badge)).toBeTruthy();
  });

  it("indents each folder one level deeper than the last", () => {
    const { container } = render(
      <HowItWorksShell s={strings(en)} helpHref={HELP} />,
    );
    const depths = Array.from(
      container.querySelectorAll<HTMLElement>(".wwd-filing-row"),
    ).map((el) => el.style.getPropertyValue("--wwd-depth"));
    // Four folders then the file, each one level in. If this ever collapses to
    // all-zero the tree still renders but stops reading as a tree.
    expect(depths).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("names all three storage destinations", () => {
    render(<HowItWorksShell s={strings(en)} helpHref={HELP} />);
    const t = en.VylanHowItWorks;
    expect(screen.getByText(t.filing_provider_google)).toBeTruthy();
    expect(screen.getByText(t.filing_provider_dropbox)).toBeTruthy();
    expect(screen.getByText(t.filing_provider_microsoft)).toBeTruthy();
  });

  it("lists the three filing rules in order", () => {
    const { container } = render(
      <HowItWorksShell s={strings(en)} helpHref={HELP} />,
    );
    const rules = container.querySelectorAll(".wwd-filing-rule");
    expect(rules.length).toBe(3);
    expect(within(rules[0] as HTMLElement).getByText(en.VylanHowItWorks.filing_rule1_title)).toBeTruthy();
    expect(within(rules[2] as HTMLElement).getByText(en.VylanHowItWorks.filing_rule3_title)).toBeTruthy();
  });
});

describe("HowItWorksShell — help centre link", () => {
  it("points at the locale-prefixed help centre passed in, in a new tab", () => {
    render(<HowItWorksShell s={strings(en)} helpHref="/fr/aide" />);
    const link = screen.getByRole("link", {
      name: en.VylanHowItWorks.integrations_help,
    });
    // Must follow the prop, not a hardcoded /help-center like the design file.
    expect(link.getAttribute("href")).toBe("/fr/aide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("HowItWorksShell — French", () => {
  it("renders the filing band and help link from the French catalogue", () => {
    render(<HowItWorksShell s={strings(fr)} helpHref={HELP} />);
    const t = fr.VylanHowItWorks;
    expect(screen.getByText(t.filing_title)).toBeTruthy();
    expect(screen.getByText(t.filing_file_badge)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: t.integrations_help }),
    ).toBeTruthy();
  });

  it("has no English left in the French filing copy", () => {
    // The band was added in one pass; this catches a key that was copied over
    // and never translated.
    const e = en.VylanHowItWorks;
    const f = fr.VylanHowItWorks;
    for (const key of [
      "filing_eyebrow",
      "filing_title",
      "filing_body",
      "filing_rule1_title",
      "filing_rule2_title",
      "filing_rule3_title",
      "filing_tree_yours",
      "filing_tree_named",
      "filing_into",
      "filing_file_badge",
      "integrations_help",
    ] as const) {
      expect(f[key], `fr.${key} is still the English string`).not.toBe(e[key]);
    }
  });
});

describe("HowItWorksShell — nothing lost in the rebuild", () => {
  it("still renders the four walkthrough steps, the pay rail and the trust cards", () => {
    render(<HowItWorksShell s={strings(en)} helpHref={HELP} />);
    const t = en.VylanHowItWorks;
    expect(screen.getByText(t.step1_title)).toBeTruthy();
    expect(screen.getByText(t.step4_title)).toBeTruthy();
    expect(screen.getByText(t.pay_step3_title)).toBeTruthy();
    expect(screen.getByText(t.trust_1_title)).toBeTruthy();
    expect(screen.getByText(t.inv_mock_total)).toBeTruthy();
  });

  it("keeps both hero CTAs — the demo scroll and the see-how scroll", () => {
    render(<HowItWorksShell s={strings(en)} helpHref={HELP} />);
    expect(
      screen.getAllByRole("button", { name: en.VylanHowItWorks.cta_book }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: en.VylanHowItWorks.cta_see_how }),
    ).toBeTruthy();
  });

  it("marks every wave as decorative, so a screen reader never reads the art", () => {
    const { container } = render(
      <HowItWorksShell s={strings(en)} helpHref={HELP} />,
    );
    const waves = container.querySelectorAll(".wwd-wave");
    expect(waves.length).toBeGreaterThan(0);
    for (const wave of Array.from(waves)) {
      expect(wave.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
