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
}: {
  value: WorkflowDefinition;
  onChange: (next: WorkflowDefinition) => void;
  members: EditorMember[];
  disabled?: boolean;
  aspect?: EditorAspect;
}) {
  const t = useTranslations("Automations");
  const tStage = useTranslations("Stage");

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

  return (
    <div className="flex flex-col gap-3">
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
                    {ENTRY_ACTIONS.map((action) => {
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
