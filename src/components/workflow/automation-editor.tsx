"use client";

// The per-stage workflow editor — ONE component, per the cohesion rule. The
// automations library renders it whole (`aspect="all"`); the template page's
// sidebar renders the SAME component three times with a narrower aspect —
// Automation (flow: skip + entry actions + advance), Tasks, Assignees — the
// client-team-editor precedent: one component, a mode prop, never a copy.
//
// Controlled: `value` in, `onChange(next)` out. `disabled` renders the
// read-only view a built-in gets (look, don't touch — Clone to customize is
// the parent's affordance).

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClampedNumberInput } from "@/components/ui/clamped-number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import {
  ENGAGEMENT_STAGES,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";
import {
  ADVANCE_CONDITIONS,
  ENTRY_ACTIONS,
  type AdvanceCondition,
  type AdvanceMode,
  type EntryAction,
  type StageAssigneeRule,
  type WorkflowDefinition,
  type WorkflowStageDef,
  type WorkflowTaskDef,
} from "@/lib/workflow/definition";
import { flowSendsLetter, withFlowLetter } from "@/lib/workflow/plan";
import {
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderSettings,
  type ReminderTone,
} from "@/lib/reminder-settings";
import {
  CHASE_INTERVAL_DEFAULT,
  CHASE_INTERVAL_MAX,
  CHASE_INTERVAL_MIN,
  CHASE_MAX_DEFAULT,
  CHASE_MAX_MAX,
  CHASE_MAX_MIN,
} from "@/lib/invoices/chase-settings";
import type { WorkflowReminders } from "@/lib/workflow/definition";

// The letter is NOT a stage action anymore — it rides the send (the founder:
// "the engagement letter is supposed to be sent upon create... not the right
// flow"). It gets its own flow-level card below; offering it per stage would
// promise a fire-on-entry that the engine deliberately refuses.
const STAGE_ENTRY_ACTIONS = ENTRY_ACTIONS.filter(
  (a) => a !== "send_engagement_letter",
);

export type EditorMember = { id: string; name: string };
export type EditorAspect = "all" | "flow" | "tasks" | "assignees";

// The assignee <Select> can't hold an object, so rules round-trip through a
// string encoding. "none" = no assignee for the stage.
function encodeAssignee(rule: StageAssigneeRule | null): string {
  if (rule === "owner" || rule === "staff") return rule;
  if (rule && typeof rule === "object") return `member:${rule.member_id}`;
  return "none";
}
function decodeAssignee(v: string): StageAssigneeRule | null {
  if (v === "owner" || v === "staff") return v;
  if (v.startsWith("member:")) return { member_id: v.slice("member:".length) };
  return null;
}

export function AutomationEditor({
  value,
  onChange,
  members,
  disabled = false,
  aspect = "all",
  hideDocumentReminders = false,
  hideLetterToggle = false,
}: {
  value: WorkflowDefinition;
  onChange: (next: WorkflowDefinition) => void;
  members: EditorMember[];
  disabled?: boolean;
  aspect?: EditorAspect;
  /** The engagement builder's embedded instance sets this: per-engagement
   *  document chasing is owned by the Reminders card on the same step
   *  (engagements.reminder_settings — the column the scheduler actually
   *  reads), so offering a second documents editor here would be an editor
   *  whose edits are dead for this engagement. The invoice side stays: the
   *  snapshot's reminders.invoice IS what send.ts reads at billing time. */
  hideDocumentReminders?: boolean;
  /**
   * Hide the "Send the engagement letter for signature" switch.
   *
   * TRUE in the engagement builder, and for the same reason hideFrequency is
   * true inside a billing block: the answer is thrown away.
   *
   * A FLOW carries "this flow sends the letter", and in the automations library
   * or a request template that is the real setting — the flow is reusable and
   * nothing outranks it. An ENGAGEMENT also has an agreement choice (proposal
   * vs letter), and that choice is the whole question of how this client
   * agrees, so the builder forces the flag to match it on save:
   * `withFlowLetter(activeFlow, letterMode)`. Whatever the switch said is
   * overwritten every single time.
   *
   * Founder, seeing it on an engagement with no letter: "If I've selected no
   * engagement letter and they just accept the proposal, why send the
   * engagement letter for signature there? It shouldn't be there."
   *
   * Right on both counts — it is meaningless with no letter, and it is inert
   * WITH one. A control whose answer is discarded is worse than no control,
   * because the accountant believes it.
   */
  hideLetterToggle?: boolean;
}) {
  const t = useTranslations("Automations");
  const tStage = useTranslations("Stage");
  // Tone labels and cadence words come from the Engagements namespace — the
  // exact keys the builder and the firm-default editor already use, so the
  // same tone can never be named two ways.
  const tEng = useTranslations("Engagements");

  const showFlow = aspect === "all" || aspect === "flow";
  const showTasks = aspect === "all" || aspect === "tasks";
  const showAssignee = aspect === "all" || aspect === "assignees";

  function setStage(stage: EngagementStage, patch: Partial<WorkflowStageDef>) {
    onChange({
      ...value,
      stages: {
        ...value.stages,
        [stage]: { ...value.stages[stage], ...patch },
      },
    });
  }

  // Reminders are flow-level, like the letter. null on a side = "the firm's
  // default at creation time" — a flow only carries an opinion the founder
  // actually set, so tightening the firm default keeps steering every flow
  // that never overrode it.
  const reminders: WorkflowReminders = value.reminders ?? {
    documents: null,
    invoice: null,
  };
  function setReminders(patch: Partial<WorkflowReminders>) {
    onChange({ ...value, reminders: { ...reminders, ...patch } });
  }
  const docMode =
    reminders.documents === null
      ? "default"
      : reminders.documents.enabled
        ? "custom"
        : "off";
  const invMode =
    reminders.invoice === null
      ? "default"
      : reminders.invoice.enabled
        ? "custom"
        : "off";

  return (
    <div className="flex flex-col gap-3">
      {/* The journey starts BEFORE stage one: sending the proposal is when
          the letter goes out, and signing it is how the client accepts. One
          flow-level switch — the same fact flowSendsLetter() reads — never a
          per-stage toggle. */}
      {showFlow && !hideLetterToggle && (
        <section
          aria-label={t("flow_send_card_title")}
          className="rounded-xl border border-border bg-muted/20 p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-medium">
              {t("flow_send_card_title")}
            </h3>
            <label
              className={cn(
                "ml-auto flex cursor-pointer items-center gap-1.5 text-xs",
                disabled && "cursor-default",
              )}
            >
              <Switch
                className="scale-75"
                checked={flowSendsLetter(value)}
                onCheckedChange={(on) =>
                  onChange(withFlowLetter(value, on === true))
                }
                disabled={disabled}
              />
              {t("flow_letter_toggle")}
            </label>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("flow_letter_toggle_note")}
          </p>
        </section>
      )}

      {/* Reminders — the founder's ruling: the chases live INSIDE the
          automations, nowhere else. Documents while collecting, the invoice
          once this flow raises one. */}
      {showFlow && (
        <section
          aria-label={t("flow_reminders_card_title")}
          className="rounded-xl border border-border bg-muted/20 p-4"
        >
          <h3 className="text-sm font-medium">
            {t("flow_reminders_card_title")}
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("flow_reminders_note")}
          </p>

          {!hideDocumentReminders && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Label className="w-24 text-xs text-muted-foreground">
              {t("flow_reminders_documents")}
            </Label>
            <Select
              value={docMode}
              onValueChange={(v) =>
                setReminders({
                  documents:
                    v === "default"
                      ? null
                      : v === "off"
                        ? normalizeReminderSettings({
                            ...DEFAULT_REMINDER_SETTINGS,
                            enabled: false,
                          })
                        : // enabled:true EXPLICITLY — reusing an "off" object
                          // as-is left docMode reading "off" and the select
                          // snapping back, so Off→Custom was unreachable.
                          {
                            ...(reminders.documents ??
                              structuredClone(DEFAULT_REMINDER_SETTINGS)),
                            enabled: true,
                          },
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {t("flow_reminders_mode_default")}
                </SelectItem>
                <SelectItem value="custom">
                  {t("flow_reminders_mode_custom")}
                </SelectItem>
                <SelectItem value="off">
                  {t("flow_reminders_mode_off")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          )}
          {!hideDocumentReminders && docMode === "custom" && reminders.documents && (
            <div className="mt-2 flex flex-col gap-1.5 pl-[6.5rem]">
              {reminders.documents.steps.map((s) => (
                <div
                  key={s.tone}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <label className="flex w-40 cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      disabled={disabled}
                      onChange={(e) =>
                        setReminders({
                          documents: {
                            ...reminders.documents!,
                            steps: reminders.documents!.steps.map((x) =>
                              x.tone === s.tone
                                ? { ...x, enabled: e.target.checked }
                                : x,
                            ),
                          },
                        })
                      }
                    />
                    {tEng(`reminder_tone_${s.tone as ReminderTone}`)}
                  </label>
                  <ClampedNumberInput
                    min={1}
                    max={365}
                    value={s.days}
                    disabled={disabled || !s.enabled}
                    onCommit={(days) =>
                      setReminders({
                        documents: {
                          ...reminders.documents!,
                          steps: reminders.documents!.steps.map((x) =>
                            x.tone === s.tone ? { ...x, days } : x,
                          ),
                        },
                      })
                    }
                    aria-label={tEng("reminder_days_label")}
                    className="h-7 w-16 text-xs"
                  />
                  <span className="text-muted-foreground">
                    {tEng(
                      s.timing === "after_due"
                        ? "reminder_days_after_due"
                        : "reminder_days_after_send",
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {tEng("reminder_repeat_prefix")}
                  </span>
                  <ClampedNumberInput
                    min={1}
                    max={12}
                    value={s.repeatCount}
                    disabled={disabled || !s.enabled}
                    onCommit={(repeatCount) =>
                      setReminders({
                        documents: {
                          ...reminders.documents!,
                          steps: reminders.documents!.steps.map((x) =>
                            x.tone === s.tone ? { ...x, repeatCount } : x,
                          ),
                        },
                      })
                    }
                    aria-label={tEng("reminder_repeat_label")}
                    className="h-7 w-14 text-xs"
                  />
                  <span className="text-muted-foreground">
                    {tEng("reminder_repeat_suffix")}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Label className="w-24 text-xs text-muted-foreground">
              {t("flow_reminders_invoice")}
            </Label>
            <Select
              value={invMode}
              onValueChange={(v) =>
                setReminders({
                  invoice:
                    v === "default"
                      ? null
                      : v === "off"
                        ? {
                            enabled: false,
                            intervalDays: CHASE_INTERVAL_DEFAULT,
                            maxReminders: CHASE_MAX_DEFAULT,
                          }
                        : {
                            enabled: true,
                            intervalDays:
                              reminders.invoice?.intervalDays ??
                              CHASE_INTERVAL_DEFAULT,
                            maxReminders:
                              reminders.invoice?.maxReminders ??
                              CHASE_MAX_DEFAULT,
                          },
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {t("flow_reminders_mode_default")}
                </SelectItem>
                <SelectItem value="custom">
                  {t("flow_reminders_mode_custom")}
                </SelectItem>
                <SelectItem value="off">
                  {t("flow_reminders_mode_off")}
                </SelectItem>
              </SelectContent>
            </Select>
            {invMode === "custom" && reminders.invoice && (
              <>
                <Label className="text-xs text-muted-foreground">
                  {t("flow_chase_interval_label")}
                </Label>
                <ClampedNumberInput
                  min={CHASE_INTERVAL_MIN}
                  max={CHASE_INTERVAL_MAX}
                  value={reminders.invoice.intervalDays}
                  disabled={disabled}
                  onCommit={(intervalDays) =>
                    setReminders({
                      invoice: { ...reminders.invoice!, intervalDays },
                    })
                  }
                  aria-label={t("flow_chase_interval_label")}
                  className="h-7 w-16 text-xs"
                />
                <Label className="text-xs text-muted-foreground">
                  {t("flow_chase_max_label")}
                </Label>
                <ClampedNumberInput
                  min={CHASE_MAX_MIN}
                  max={CHASE_MAX_MAX}
                  value={reminders.invoice.maxReminders}
                  disabled={disabled}
                  onCommit={(maxReminders) =>
                    setReminders({
                      invoice: { ...reminders.invoice!, maxReminders },
                    })
                  }
                  aria-label={t("flow_chase_max_label")}
                  className="h-7 w-14 text-xs"
                />
              </>
            )}
          </div>
        </section>
      )}
      {ENGAGEMENT_STAGES.map((stage, i) => {
        const def = value.stages[stage];
        const lockedStage = stage === "collecting" || stage === "completed";
        const ghosted = def.skipped;
        // A narrowed aspect on a stage with nothing to show (completed has no
        // assignee control, for instance) still renders the numbered card, so
        // the six-stage shape stays legible in every section.
        return (
          <section
            key={stage}
            aria-label={tStage(stageLabelKey(stage))}
            className={cn(
              "rounded-xl border border-border p-4 transition-opacity",
              ghosted && "opacity-50",
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">
                <span className="mr-1.5 text-muted-foreground">{i + 1} ·</span>
                {tStage(stageLabelKey(stage))}
              </h3>
              {ghosted && (
                <span className="text-xs text-muted-foreground">
                  {t("skipped_chip")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-4">
                {showAssignee && stage !== "completed" && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">
                      {t("assignee_label")}
                    </Label>
                    <Select
                      value={encodeAssignee(def.assignee)}
                      onValueChange={(v) =>
                        setStage(stage, { assignee: decodeAssignee(v) })
                      }
                      disabled={disabled || ghosted}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          {t("assignee_none")}
                        </SelectItem>
                        <SelectItem value="owner">
                          {t("assignee_owner")}
                        </SelectItem>
                        <SelectItem value="staff">
                          {t("assignee_staff")}
                        </SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={`member:${m.id}`}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Skip — never for collecting/completed (the engine refuses
                    it anyway; hiding the switch says so honestly). */}
                {showFlow && !lockedStage && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">
                      {t("skip_label")}
                    </Label>
                    <Switch
                      checked={def.skipped}
                      onCheckedChange={(on) =>
                        setStage(stage, { skipped: on === true })
                      }
                      disabled={disabled}
                    />
                  </div>
                )}
              </div>
            </div>

            {!ghosted && (showFlow || showTasks) && (
              <div className="mt-3 flex flex-col gap-3">
                {showFlow && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-xs text-muted-foreground">
                      {t("on_entry_label")}
                    </span>
                    {STAGE_ENTRY_ACTIONS.map((action) => {
                      const on = def.on_entry.includes(action);
                      return (
                        <label
                          key={action}
                          className={cn(
                            "flex cursor-pointer items-center gap-1.5 text-xs",
                            disabled && "cursor-default",
                          )}
                        >
                          <Switch
                            className="scale-75"
                            checked={on}
                            onCheckedChange={(next) =>
                              setStage(stage, {
                                on_entry:
                                  next === true
                                    ? ([
                                        ...def.on_entry,
                                        action,
                                      ] as EntryAction[])
                                    : def.on_entry.filter((a) => a !== action),
                              })
                            }
                            disabled={disabled}
                          />
                          {t(`action_${action}`)}
                        </label>
                      );
                    })}
                  </div>
                )}

                {showTasks && (
                  <div>
                    <span className="text-xs text-muted-foreground">
                      {t("tasks_label")}
                    </span>
                    <div className="mt-1.5 flex flex-col gap-1.5">
                      {def.tasks.map((task, ti) => (
                        <TaskRow
                          key={ti}
                          task={task}
                          disabled={disabled}
                          canMoveUp={ti > 0}
                          canMoveDown={ti < def.tasks.length - 1}
                          onChange={(next) =>
                            setStage(stage, {
                              tasks: def.tasks.map((x, xi) =>
                                xi === ti ? next : x,
                              ),
                            })
                          }
                          onMove={(dir) => {
                            const next = [...def.tasks];
                            const [row] = next.splice(ti, 1);
                            next.splice(ti + dir, 0, row);
                            setStage(stage, { tasks: next });
                          }}
                          onRemove={() =>
                            setStage(stage, {
                              tasks: def.tasks.filter((_, xi) => xi !== ti),
                            })
                          }
                        />
                      ))}
                      {!disabled && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-fit text-xs"
                          onClick={() =>
                            setStage(stage, {
                              tasks: [
                                ...def.tasks,
                                { title_en: "", title_fr: "", assignee: null },
                              ],
                            })
                          }
                        >
                          <Plus className="mr-1 size-3.5" aria-hidden />
                          {t("add_task")}
                        </Button>
                      )}
                      {disabled && def.tasks.length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("no_tasks")}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {showFlow && stage !== "completed" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("advance_label")}
                    </span>
                    <Select
                      value={def.advance?.condition ?? "manual"}
                      onValueChange={(v) =>
                        setStage(stage, {
                          advance: {
                            condition: v as AdvanceCondition,
                            mode: def.advance?.mode ?? "automatic",
                          },
                        })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-64 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ADVANCE_CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {t(`condition_${c}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={def.advance?.mode ?? "automatic"}
                      onValueChange={(v) =>
                        setStage(stage, {
                          advance: {
                            condition: def.advance?.condition ?? "manual",
                            mode: v as AdvanceMode,
                          },
                        })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">
                          {t("mode_automatic")}
                        </SelectItem>
                        <SelectItem value="confirm">
                          {t("mode_confirm")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({
  task,
  disabled,
  canMoveUp,
  canMoveDown,
  onChange,
  onMove,
  onRemove,
}: {
  task: WorkflowTaskDef;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (next: WorkflowTaskDef) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Automations");
  if (disabled) {
    return (
      <div className="text-xs text-foreground">
        • {task.title_en}
        {task.title_fr && task.title_fr !== task.title_en ? (
          <span className="text-muted-foreground"> / {task.title_fr}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={task.title_en}
        placeholder={t("task_title_en")}
        className="h-8 text-xs"
        onChange={(e) => onChange({ ...task, title_en: e.target.value })}
      />
      <Input
        value={task.title_fr}
        placeholder={t("task_title_fr")}
        className="h-8 text-xs"
        onChange={(e) => onChange({ ...task, title_fr: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={t("task_move_up")}
        disabled={!canMoveUp}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="size-3.5" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={t("task_move_down")}
        disabled={!canMoveDown}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="size-3.5" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={t("task_remove")}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
