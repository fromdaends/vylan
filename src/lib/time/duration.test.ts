import { describe, it, expect } from "vitest";
import {
  parseDurationToMinutes,
  formatMinutes,
  formatElapsed,
} from "./duration";

describe("parseDurationToMinutes", () => {
  it("reads the spec's three examples", () => {
    expect(parseDurationToMinutes("1:30")).toBe(90);
    expect(parseDurationToMinutes("1.5")).toBe(90);
    expect(parseDurationToMinutes("90m")).toBe(90);
  });

  it("treats a bare number as hours — decided once, in the module header", () => {
    expect(parseDurationToMinutes("2")).toBe(120);
    expect(parseDurationToMinutes("0.25")).toBe(15);
  });

  it("folds the French comma decimal", () => {
    expect(parseDurationToMinutes("1,5")).toBe(90);
    expect(parseDurationToMinutes("0,5")).toBe(30);
  });

  it("reads hour-and-minute compounds", () => {
    expect(parseDurationToMinutes("1h30")).toBe(90);
    expect(parseDurationToMinutes("1h 30m")).toBe(90);
    expect(parseDurationToMinutes("2h")).toBe(120);
    expect(parseDurationToMinutes("1.5h")).toBe(90);
  });

  it("reads minute suffixes in their variants", () => {
    expect(parseDurationToMinutes("45 min")).toBe(45);
    expect(parseDurationToMinutes("45min")).toBe(45);
    expect(parseDurationToMinutes("45 minutes")).toBe(45);
  });

  it("is whitespace- and case-tolerant", () => {
    expect(parseDurationToMinutes("  1:30  ")).toBe(90);
    expect(parseDurationToMinutes("90M")).toBe(90);
    expect(parseDurationToMinutes("2H")).toBe(120);
  });

  it("refuses garbage, zero and negatives rather than guessing", () => {
    expect(parseDurationToMinutes("")).toBeNull();
    expect(parseDurationToMinutes("abc")).toBeNull();
    expect(parseDurationToMinutes("0")).toBeNull();
    expect(parseDurationToMinutes("0m")).toBeNull();
    expect(parseDurationToMinutes("0:00")).toBeNull();
    expect(parseDurationToMinutes("-5")).toBeNull();
    expect(parseDurationToMinutes("1:75")).toBeNull(); // 75 is not a minute count
    expect(parseDurationToMinutes("1.5.5")).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("says hours and minutes only when each exists", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(0)).toBe("0m");
  });
});

describe("formatElapsed", () => {
  it("stays mm:ss under an hour and grows to h:mm:ss over it", () => {
    expect(formatElapsed(7)).toBe("0:07");
    expect(formatElapsed(765)).toBe("12:45");
    expect(formatElapsed(3789)).toBe("1:03:09");
  });

  it("never renders a negative clock", () => {
    expect(formatElapsed(-30)).toBe("0:00");
  });
});
