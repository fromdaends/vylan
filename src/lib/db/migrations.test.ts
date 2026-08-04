import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// This test exists because two migrations shipped to main with the SAME number
// and nothing in the repo noticed.
//
// 1510_engagement_details.sql (#1312) and 1510_workflow_automations.sql (#1318)
// merged 40 minutes apart on 2026-08-04, both claiming version 1510. Supabase's
// ledger (supabase_migrations.schema_migrations) keys on the VERSION and stores
// no filename, so the second file of a duplicate pair can never be recorded:
// `supabase migration list` showed one remote row for 1510 and the other local
// 1510 with a blank remote column. Nothing breaks on a database that already
// has both applied by hand — it breaks on a REPLAY, where exactly one of the
// two runs and the other's tables silently never exist.
//
// This is the same class of bug that broke every migration PR for months and
// was fixed by hand in #1137. It recurs because CLAUDE.md's "highest + 10" rule
// is computed by every parallel session at the same moment, so two sessions
// pick the same free number and both are right when they pick it. The collision
// appears at MERGE time, which is exactly when no human is re-running the
// manual `ls | sed | sort | uniq -d` check.
//
// A warning was even written into .active-sessions.md before #1318 merged
// ("still declares its own 1510 and will hit the same wall") and it merged
// anyway — a note in a log is not a guard. This is the guard.

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/** Every migration filename, sorted, e.g. "1510_engagement_details.sql". */
function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The leading version of a migration filename — "1510_foo.sql" -> "1510". */
function versionOf(file: string) {
  return file.split("_")[0];
}

describe("supabase migrations", () => {
  it("has migration files to check", () => {
    // Guards the guard: a wrong path would make every assertion below pass
    // vacuously over an empty list.
    expect(migrationFiles().length).toBeGreaterThan(100);
  });

  it("never gives two migrations the same version number", () => {
    const byVersion = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const version = versionOf(file);
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }

    const duplicates = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.join(" + ")}`);

    // Named in the failure so the fix is obvious: renumber the LATER merge to
    // the next free number, never delete either file.
    expect(duplicates).toEqual([]);
  });

  it("names every migration <version>_<description>.sql", () => {
    // A filename the version cannot be parsed out of is a duplicate waiting to
    // happen — the check above would silently group it under a junk key.
    const malformed = migrationFiles().filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
    expect(malformed).toEqual([]);
  });
});
