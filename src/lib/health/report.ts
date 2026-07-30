// The system check as TEXT, for the command line.
//
// /settings/health renders the same findings as a page, but that page is
// owner-gated by a browser session — which a command line cannot hold. Since the
// check is mostly an instrument for whoever is fixing Vylan, it has to be
// readable without signing in.
//
// Same probes, same judgement, same wording. Only the rendering differs, and it
// lives here rather than in the runner so the formatting is testable.

import type { Finding, Level } from "./verdict";

const MARK: Record<Level, string> = { ok: "ok  ", warn: "WARN", fail: "FAIL" };

export function formatHealthReport(
  findings: Finding[],
  context: { firmName?: string | null } = {},
): string {
  const problems = findings.filter((f) => f.level !== "ok");
  const passing = findings.filter((f) => f.level === "ok");
  const worst: Level = problems.some((f) => f.level === "fail")
    ? "fail"
    : problems.length > 0
      ? "warn"
      : "ok";

  const lines: string[] = [
    "",
    `SYSTEM CHECK${context.firmName ? ` — ${context.firmName}` : ""}`,
    "─".repeat(72),
    worst === "ok"
      ? "Everything checks out."
      : `${problems.length} thing${problems.length === 1 ? "" : "s"} ${
          worst === "fail" ? "broken or " : ""
        }worth a look.`,
    "",
  ];

  for (const f of problems) {
    lines.push(`[${MARK[f.level]}] ${f.summary}`);
    // Indented so a wall of findings still scans, and so the action is visually
    // attached to the thing it fixes.
    if (f.action) lines.push(`         → ${f.action}`);
    lines.push("");
  }

  if (passing.length > 0) {
    lines.push("WORKING", "─".repeat(72));
    for (const f of passing) lines.push(`[ ok ] ${f.summary}`);
    lines.push("");
  }

  return lines.join("\n");
}
