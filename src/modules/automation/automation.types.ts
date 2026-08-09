/**
 * modules/automation/automation.types.ts
 *
 * Shared types for the Automation module — status-change and task-created
 * trigger rules that run configured actions inside the automation worker.
 */

export type AutomationTrigger = 'STATUS_CHANGED' | 'TASK_CREATED';

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

export type TriggerConfig = StatusChangedTriggerConfig | TaskCreatedTriggerConfig;

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
}
