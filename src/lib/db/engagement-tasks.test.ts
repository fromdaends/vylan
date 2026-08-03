import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TASK_STATUSES, toTaskStatus } from "./engagement-tasks";

describe("task status", () => {
  it("resolves the three real values", () => {
    for (const s of TASK_STATUSES) expect(toTaskStatus(s)).toBe(s);
  });

  it("falls back to todo rather than throwing", () => {
    // A task written by a newer build must still render in an older one during
    // a rollout, and an unreadable status must not blank the row.
    for (const junk of [undefined, null, "", "DONE", "complete", 3, {}]) {
      expect(toTaskStatus(junk)).toBe("todo");
    }
  });
});

// ── THE WALL ─────────────────────────────────────────────────────────────────
//
// The entire promise of this feature is that the client never sees the firm's
// internal steps, and that promise is STRUCTURAL: the portal renders
// request_items and uploaded_files, and simply has no code that reads
// engagement_tasks.
//
// A comment saying so decays. This test does not. It walks the portal's route
// tree and fails the moment anything under it references the table or the
// module that reads it — which is exactly the change that would leak a firm's
// private notes to its client, and exactly the change that would look harmless
// in review ("I just needed the task list here too").
//
// If this ever fails: do not add an exception. The portal wanting this data is
// the signal that somebody is about to break the wall.
describe("the portal cannot reach the firm's internal work", () => {
  const PORTAL_ROOTS = [
    join(process.cwd(), "src/app/r"),
    join(process.cwd(), "src/app/[locale]/r"),
    join(process.cwd(), "src/components/portal"),
  ];

  const FORBIDDEN = ["engagement_tasks", "engagement-tasks"];

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out; // a root that does not exist is not a failure
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (/\.(ts|tsx)$/.test(full)) out.push(full);
    }
    return out;
  }

  it("names the table nowhere the client's pages can run", () => {
    const offenders: string[] = [];
    for (const root of PORTAL_ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN) {
          if (src.includes(needle)) offenders.push(`${file} → ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is actually looking at something", () => {
    // Guards the guard: if the portal moves and every root above stops
    // existing, the test above would pass by reading zero files.
    const total = PORTAL_ROOTS.reduce((n, r) => n + walk(r).length, 0);
    expect(total).toBeGreaterThan(0);
  });
});
