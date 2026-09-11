import { Job } from "bullmq";
import { sendAdminContactNotification, sendUserAutoReply } from "../../modules/contact/contact.email.js";
import { sendBanEmail, sendWorkspaceDeletedEmail, sendWorkspaceLimitsChangedEmail } from "../../admin/admin.email.js";
import { sendInvitationEmail, sendDataExportEmail } from "../../utils/email.js";
import type { SendEmailJobData } from "../queues/email.queue.js";

/**
 * Processor for email jobs. Previously owned by a dedicated Worker instance;
 * now invoked by the consolidated jobs worker (src/queue/workers/jobs.worker.ts).
 */
export async function processEmailJob(job: Job<SendEmailJobData>): Promise<void> {
  const { type, to, data } = job.data;

  console.log(`[EmailWorker] Processing ${type} job ${job.id}`);

  switch (type) {
    case "admin-contact-notification":
      await sendAdminContactNotification(data.contactData, data.messageId, data.ip);
      break;

    case "user-auto-reply":
      await sendUserAutoReply(data.contactData);
      break;

    case "ban-email":
      await sendBanEmail({
        toEmail: data.toEmail,
        toName: data.toName,
        reason: data.reason,
      });
      break;

    case "workspace-deleted-email":
      await sendWorkspaceDeletedEmail({
        toEmail: data.toEmail,
        toName: data.toName,
        workspaceName: data.workspaceName,
        reason: data.reason,
        hardDelete: data.hardDelete,
      });
      break;

    case "workspace-limits-changed-email":
      await sendWorkspaceLimitsChangedEmail({
        toEmail: data.toEmail,
        toName: data.toName,
        workspaceName: data.workspaceName,
        changes: data.changes,
      });
      break;

    case "invitation-email":
      await sendInvitationEmail(to, data.invitation);
      break;

    case "data-export-email":
      await sendDataExportEmail({
        toEmail: data.toEmail,
        toName: data.toName,
        fileName: data.fileName,
        json: data.json,
      });
      break;

    default:
      throw new Error(`Unknown email job type: ${type}`);
  }

  console.log(`[EmailWorker] Completed ${type} job ${job.id}`);
}
