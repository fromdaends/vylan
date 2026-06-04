import { describe, it, expect, afterEach } from "vitest";
import { toStrictSchema, isOpenAiConfigured } from "./openai-classify";

describe("toStrictSchema", () => {
  it("locks down the root object: additionalProperties:false + required = all keys", () => {
    const out = toStrictSchema({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a"],
    }) as Record<string, unknown>;
    expect(out.additionalProperties).toBe(false);
    expect(out.required).toEqual(["a", "b"]);
  });

  it("strips unsupported numeric bounds (minimum/maximum) anywhere in the tree", () => {
    const out = toStrictSchema({
      type: "object",
      properties: {
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    }) as Record<string, unknown>;
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.confidence).not.toHaveProperty("minimum");
    expect(props.confidence).not.toHaveProperty("maximum");
    expect(props.confidence.type).toBe("number");
  });

  it("recurses into nested objects (e.g. array items) and locks them down too", () => {
    const out = toStrictSchema({
      type: "object",
      properties: {
        amounts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
          },
        },
      },
    }) as Record<string, unknown>;
    const props = out.properties as Record<string, Record<string, unknown>>;
    const items = (props.amounts.items as Record<string, unknown>);
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(["label", "value"]);
  });

  it("preserves enums, nullable type unions, and descriptions", () => {
    const out = toStrictSchema({
      type: "object",
      properties: {
        primary_issue: {
          type: ["string", "null"],
          enum: ["text_unreadable", null],
          description: "the issue",
        },
      },
    }) as Record<string, unknown>;
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.primary_issue.type).toEqual(["string", "null"]);
    expect(props.primary_issue.enum).toEqual(["text_unreadable", null]);
    expect(props.primary_issue.description).toBe("the issue");
  });

  it("leaves scalar (non-object) schema nodes untouched", () => {
    const out = toStrictSchema({ type: "string" }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("additionalProperties");
    expect(out.type).toBe("string");
  });
});

describe("isOpenAiConfigured", () => {
  const original = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it("is true only when a non-empty key is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isOpenAiConfigured()).toBe(true);
    process.env.OPENAI_API_KEY = "   ";
    expect(isOpenAiConfigured()).toBe(false);
    delete process.env.OPENAI_API_KEY;
    expect(isOpenAiConfigured()).toBe(false);
  });
});
