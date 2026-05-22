import { describe, expect, it } from "vitest";
import {
  DemoStep1Schema,
  DemoStep2Schema,
  DemoStep3Schema,
} from "./demo-request.schema";

describe("DemoStep1Schema", () => {
  it("accepts valid step 1 input + trims + lowercases email", () => {
    const out = DemoStep1Schema.parse({
      contact_name: "  Phil Jette  ",
      email: "  Phil@Vylan.APP  ",
      firm_name: "  Acme CPA  ",
    });
    expect(out.contact_name).toBe("Phil Jette");
    expect(out.email).toBe("phil@vylan.app");
    expect(out.firm_name).toBe("Acme CPA");
  });

  it("rejects invalid email", () => {
    const res = DemoStep1Schema.safeParse({
      contact_name: "Phil",
      email: "not-an-email",
      firm_name: "Acme",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe("invalid_email");
    }
  });

  it("rejects too-short name and firm", () => {
    const res = DemoStep1Schema.safeParse({
      contact_name: "P",
      email: "p@v.app",
      firm_name: "A",
    });
    expect(res.success).toBe(false);
  });
});

describe("DemoStep2Schema", () => {
  it("accepts a fully-filled qualifying step", () => {
    const out = DemoStep2Schema.parse({
      firm_size: "2_5",
      client_volume: "25_100",
      current_tool: "taxdome",
    });
    expect(out.firm_size).toBe("2_5");
    expect(out.client_volume).toBe("25_100");
    expect(out.current_tool).toBe("taxdome");
  });

  it("rejects invalid enum values", () => {
    const res = DemoStep2Schema.safeParse({
      firm_size: "huge",
      client_volume: "many",
      current_tool: "fancy",
    });
    expect(res.success).toBe(false);
  });

  it("requires current_tool_other when current_tool is other_software", () => {
    const res = DemoStep2Schema.safeParse({
      firm_size: "solo",
      client_volume: "under_25",
      current_tool: "other_software",
      // missing current_tool_other
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const tn = res.error.issues.find(
        (i) => i.path.join(".") === "current_tool_other",
      );
      expect(tn?.message).toBe("tool_name_required");
    }
  });

  it("accepts other_software with the free-text name supplied", () => {
    const res = DemoStep2Schema.safeParse({
      firm_size: "solo",
      client_volume: "under_25",
      current_tool: "other_software",
      current_tool_other: "Citrix ShareFile",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty-string current_tool_other when other_software is picked", () => {
    const res = DemoStep2Schema.safeParse({
      firm_size: "solo",
      client_volume: "under_25",
      current_tool: "other_software",
      current_tool_other: "   ",
    });
    expect(res.success).toBe(false);
  });
});

describe("DemoStep3Schema", () => {
  it("accepts a complete step 3 with opt-in true and phone empty", () => {
    const out = DemoStep3Schema.parse({
      phone: "",
      province: "QC",
      preferred_language: "fr",
      marketing_opt_in: true,
    });
    expect(out.province).toBe("QC");
    expect(out.preferred_language).toBe("fr");
    expect(out.marketing_opt_in).toBe(true);
  });

  it("rejects unknown provinces", () => {
    const res = DemoStep3Schema.safeParse({
      province: "FL",
      preferred_language: "en",
      marketing_opt_in: false,
    });
    expect(res.success).toBe(false);
  });

  it("rejects non-boolean marketing_opt_in", () => {
    const res = DemoStep3Schema.safeParse({
      province: "ON",
      preferred_language: "en",
      marketing_opt_in: "yes",
    });
    expect(res.success).toBe(false);
  });
});
