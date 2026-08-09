/**
 * modules/automation/automation.events.ts
 *
 * Emits automation events from *controller* code after user-initiated
 * mutations only. Automation actions run inside the worker and never call
 * back into this emitter, so a rule can never re-trigger itself or another
 * rule — loop-safety by construction (FEATURE_PLANS.md §2.B).
 */
import { addAutomationEventJob } from "../../queue/queues/automation.queue.js";
import type { AutomationEvent } from "./automation.types.js";

export function emitAutomationEvent(event: AutomationEvent): void {
  addAutomationEventJob(event).catch((error) => {
    console.error("[Automation] Failed to enqueue automation event:", error);
  });
}
