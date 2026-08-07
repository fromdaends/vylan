// PLATFORM HEALTH — the things that break quietly.
//
// Background jobs are where Vylan's reminders, recurring engagements, invoice
// chases and notification emails actually happen. A failed job produces no user
// complaint until a client does not get chased, so a failure count nobody looks
// at is the same as no failure count. Same for the AI monthly cap: a firm that
// crosses it starts silently getting refusals.
//
// The truncation warning at the bottom exists because of a rule this codebase
// learned the hard way — a list that silently stops is read as complete. If any
// read hit its row ceiling it says so, by name, here.

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Panel, StatGrid } from "@/components/founders/stat-grid";
import { relativeAge } from "@/lib/founders/aggregate";
import type { CappedRead, HealthSnapshot } from "@/lib/founders/types";

export function HealthView({
  health,
  capped,
  allowlist,
  nowMs,
  labels,
}: {
  health: HealthSnapshot;
  capped: CappedRead[];
  allowlist: string[];
  nowMs: number;
  labels: {
    jobs: string;
    jobsPending: string;
    jobsRunning: string;
    jobsFailed: string;
    jobsDone: string;
    jobsHealthy: string;
    failures: string;
    attempts: string;
    ai: string;
    aiUsed: string;
    aiUsedHint: string;
    aiOverHalf: string;
    aiOverHalfHint: string;
    truncation: string;
    truncationWarning: string;
    truncationNone: string;
    access: string;
    accessHint: string;
  };
}) {
  const failing = health.jobsFailed > 0;

  return (
    <div className="space-y-5">
      <Panel title={labels.jobs}>
        <StatGrid
          columns={4}
          stats={[
            { key: "pending", label: labels.jobsPending, value: String(health.jobsPending) },
            { key: "running", label: labels.jobsRunning, value: String(health.jobsRunning) },
            {
              key: "failed",
              label: labels.jobsFailed,
              value: String(health.jobsFailed),
              muted: !failing,
            },
            { key: "done", label: labels.jobsDone, value: String(health.jobsDone), muted: true },
          ]}
        />

        {health.recentFailures.length > 0 ? (
          <div className="mt-5">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {labels.failures}
            </h4>
            <ul className="divide-y divide-border/50">
              {health.recentFailures.map((f) => (
                <li key={f.id} className="py-2">
                  <p className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden />
                    <span className="font-medium">{f.kind}</span>
                    <span className="text-xs text-muted-foreground">
                      {labels.attempts}: {f.attempts} · {relativeAge(f.createdAt, nowMs)}
                    </span>
                  </p>
                  {f.lastError && (
                    // Wrapped, not truncated: the error text IS the diagnosis,
                    // and a one-line clip of a stack trace helps nobody.
                    <p className="mt-1 break-words pl-5.5 font-mono text-xs text-muted-foreground">
                      {f.lastError}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
            {labels.jobsHealthy}
          </p>
        )}
      </Panel>

      <Panel title={labels.ai}>
        <StatGrid
          columns={3}
          stats={[
            {
              key: "used",
              label: labels.aiUsed,
              value: String(health.aiUsedThisMonth),
              hint: labels.aiUsedHint,
            },
            {
              key: "half",
              label: labels.aiOverHalf,
              value: String(health.aiFirmsOverHalfCap),
              hint: labels.aiOverHalfHint,
              muted: health.aiFirmsOverHalfCap === 0,
            },
          ]}
        />
      </Panel>

      <Panel title={labels.truncation}>
        {capped.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
            {labels.truncationNone}
          </p>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <span>{labels.truncationWarning}</span>
            </p>
            <ul className="mt-2 pl-6 text-sm">
              {capped.map((c) => (
                <li key={c.table} className="font-mono text-xs">
                  {c.table} · {c.cap.toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title={labels.access}>
        <p className="mb-2 text-sm text-muted-foreground">{labels.accessHint}</p>
        <ul className="space-y-1">
          {allowlist.map((email) => (
            <li key={email} className="font-mono text-xs">
              {email}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
