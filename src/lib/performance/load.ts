// Top-level Performance loader: resolves the range once, then loads all three
// sections for the firm in parallel (RLS scopes every query to the caller's
// firm). Each section loader is internally fail-soft — it logs and returns zeros
// on a query error — so the page can always render something honest. `nowMs` is
// injectable for tests / deterministic rendering.

import { resolveRange } from "./range";
import { loadMoneySection } from "./money";
import { loadAiSection } from "./ai";
import { loadAutomationSection } from "./automation";
import { loadDocumentsSection } from "./documents";
import type { PerformanceData, PerformanceRange } from "./types";

export async function loadPerformance(
  range: PerformanceRange,
  nowMs: number = Date.now(),
): Promise<PerformanceData> {
  const resolved = resolveRange(range, nowMs);
  const [money, ai, automation, documents] = await Promise.all([
    loadMoneySection(resolved),
    loadAiSection(resolved),
    loadAutomationSection(resolved),
    loadDocumentsSection(resolved),
  ]);
  return { range, money, ai, automation, documents };
}
