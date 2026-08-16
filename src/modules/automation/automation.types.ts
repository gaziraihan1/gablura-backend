/**
 * modules/automation/automation.types.ts
 *
 * Shared types for the Automation module — status-change and task-created
 * trigger rules that run configured actions inside the automation worker.
 */

export type AutomationTrigger =
  | 'STATUS_CHANGED'
  | 'TASK_CREATED'
  | 'DUE_DATE_APPROACHING'
  | 'ASSIGNEE_CHANGED'
  | 'LABEL_ADDED'
  | 'MENTION';

export type AutomationActionType = 'ASSIGN_USER' | 'SET_PRIORITY' | 'NOTIFY_MEMBERS';

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED';

export type TaskPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

// ─── Trigger configs ──────────────────────────────────────────────────────────

export interface StatusChangedTriggerConfig {
  fromStatus?: TaskStatus | null;
  toStatus?: TaskStatus | null;
}

export interface TaskCreatedTriggerConfig {
  projectId?: string | null;
}

export interface DueDateApproachingTriggerConfig {
  /** Fire when a task's due date is within this many days from now. */
  daysBefore?: number | null;
}

export interface AssigneeChangedTriggerConfig {
  /** Optional filter — only fire when this specific user is assigned. */
  assigneeUserId?: string | null;
}

export interface LabelAddedTriggerConfig {
  /** Optional filter — only fire when this specific label is added. */
  labelId?: string | null;
}

export interface MentionTriggerConfig {
  /** Optional filter — only fire when this specific user is mentioned. */
  mentionedUserId?: string | null;
}

export type TriggerConfig =
  | StatusChangedTriggerConfig
  | TaskCreatedTriggerConfig
  | DueDateApproachingTriggerConfig
  | AssigneeChangedTriggerConfig
  | LabelAddedTriggerConfig
  | MentionTriggerConfig;

// ─── Action configs ───────────────────────────────────────────────────────────

export interface AssignUserActionConfig {
  /** Exact user id to assign to the task. */
  assigneeUserId?: string | null;
  /** Assign the workspace member that owns this email address. */
  email?: string | null;
  /** Assign the project owner, or the actor who triggered the event. */
  role?: 'project-owner' | 'actor' | null;
}

export interface SetPriorityActionConfig {
  priority: TaskPriority;
}

export interface NotifyMembersActionConfig {
  message?: string | null;
}

export interface AutomationAction {
  type: AutomationActionType;
  config: AssignUserActionConfig | SetPriorityActionConfig | NotifyMembersActionConfig;
}

// ─── Rule inputs / records ────────────────────────────────────────────────────

export interface AutomationRuleInput {
  workspaceId: string;
  projectId?: string | null;
  name: string;
  triggerType: AutomationTrigger;
  triggerConfig?: TriggerConfig;
  actions?: AutomationAction[];
}

export interface AutomationRuleUpdateInput {
  projectId?: string | null;
  name?: string;
  triggerType?: AutomationTrigger;
  triggerConfig?: TriggerConfig;
  actions?: AutomationAction[];
  enabled?: boolean;
}

export interface AutomationRuleRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  triggerType: AutomationTrigger;
  triggerConfig: unknown;
  actions: unknown;
  enabled: boolean;
  runCount: number;
  lastRunAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Event emitted by user-initiated controller actions ──────────────────────

export interface AutomationEvent {
  trigger: AutomationTrigger;
  taskId: string;
  actorId: string;
  workspaceId: string;
  projectId?: string | null;
  /** Loosely typed on purpose — the task module uses its own status strings. */
  fromStatus?: string | null;
  toStatus?: string | null;
  /** ISO due date, set by the cron for DUE_DATE_APPROACHING events. */
  dueDate?: string | null;
  /** When present, the worker only executes this specific rule (cron-targeted events). */
  ruleId?: string | null;
  /** Assignees added by the mutation that produced this event. */
  addedAssigneeIds?: string[];
  /** Labels added by the mutation that produced this event. */
  addedLabelIds?: string[];
  /** Users mentioned in a comment that produced this event. */
  mentionedUserIds?: string[];
}
