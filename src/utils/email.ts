import escape from "escape-html";
import {
  getSmtpTransporter,
  getFromAddress,
  getClientUrl,
  baseWrapper,
  plainTextFooter,
} from "../lib/email/shared.js";

function getTransporter() {
  const t = getSmtpTransporter();
  if (!t) {
    console.warn("[email] Missing SMTP env vars — emails will be skipped");
  }
  return t;
}

// ─── Template builders ───────────────────────────────────────────────────────

function buildInvitationHtml(params: {
  inviteLink: string;
  senderName: string;
  workspaceName: string;
  toName?: string;
}): string {
  const { inviteLink, senderName, workspaceName, toName } = params;
  const greeting = toName ? escape(toName) : "there";
  const safeSender = escape(senderName);
  const safeWorkspace = escape(workspaceName);

  return baseWrapper(`
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0a0a0a;">You&rsquo;re Invited!</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">Hi ${greeting},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">
      <strong>${safeSender}</strong> has invited you to join the
      <strong>${safeWorkspace}</strong> workspace on Focura.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:#0a0a0a;border-radius:8px;">
          <a href="${escape(inviteLink)}"
             style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
            Accept Invitation
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#737373;line-height:1.6;">
      Or copy this link:
      <br />
      <span style="color:#0a0a0a;font-size:12px;word-break:break-all;">${escape(inviteLink)}</span>
    </p>
    <p style="margin:0;font-size:13px;color:#737373;">— The Focura Team</p>
  `);
}  function buildInvitationText(params: {
  inviteLink: string;
  senderName: string;
  workspaceName: string;
  toName?: string;
}): string {
  const { inviteLink, senderName, workspaceName, toName } = params;
  const greeting = toName || "there";

  return [
    `Hi ${greeting},`,
    "",
    `${senderName} has invited you to join the ${workspaceName} workspace on Focura.`,
    "",
    `Accept: ${inviteLink}`,
    "",
    "— The Focura Team",
  ].join("\n") + plainTextFooter();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendInvitationEmail(
  email: string,
  invitation: { token: string; senderName?: string; workspaceName?: string; toName?: string },
): Promise<void> {
  const clientUrl = getClientUrl();
  const inviteLink = `${clientUrl}/invitations/${invitation.token}`;
  const senderName = invitation.senderName ?? "A Focura user";
  const workspaceName = invitation.workspaceName ?? "a workspace";

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Skipping invitation to ${email} — SMTP not configured. Link: ${inviteLink}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"Focura" <${getFromAddress()}>`,
      to: email,
      subject: `${senderName} invited you to join ${workspaceName} on Focura`,
      html: buildInvitationHtml({ inviteLink, senderName, workspaceName, toName: invitation.toName }),
      text: buildInvitationText({ inviteLink, senderName, workspaceName, toName: invitation.toName }),
    });
  } catch (error) {
    console.error(`[email] Failed to send invitation to ${email}:`, error);
    throw error;
  }
}

export async function sendDataExportEmail(params: {
  toEmail: string;
  toName?: string | null;
  fileName: string;
  json: string;
}): Promise<void> {
  const { toEmail, toName, fileName, json } = params;
  const greeting = toName ? escape(toName) : "there";

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Skipping data export to ${toEmail} — SMTP not configured.`);
    return;
  }

  try {
    await transporter.sendMail({
      from: `"Focura" <${getFromAddress()}>`,
      to: toEmail,
      subject: "Your Focura data export is ready",
      html: baseWrapper(`
        <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0a0a0a;">Your data export is ready</h2>
        <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">Hi ${greeting},</p>
        <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">
          As requested, here is a JSON export of your Focura account data — your
          profile, workspaces, projects, tasks, comments, focus sessions, time
          entries, notifications, and activity.
        </p>
        <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">
          The file is attached as <strong>${escape(fileName)}</strong>. Keep it
          somewhere safe — it contains personal data.
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#737373;line-height:1.6;">
          Exports are generated on request from Settings &rarr; Account &rarr; Privacy.
          If you didn&rsquo;t request this export, contact
          <a href="mailto:privacy@focura.app" style="color:#0a0a0a;">privacy@focura.app</a>.
        </p>
        <p style="margin:0;font-size:13px;color:#737373;">— The Focura Team</p>
      `),
      text: [
        "Your data export is ready",
        "",
        `Hi ${greeting},`,
        "",
        "As requested, here is a JSON export of your Focura account data — profile, workspaces, projects, tasks, comments, focus sessions, time entries, notifications, and activity.",
        "",
        `The file is attached as ${fileName}. Keep it somewhere safe — it contains personal data.`,
        "",
        "Exports are generated on request from Settings > Account > Privacy.",
        "If you didn't request this export, contact privacy@focura.app.",
        "",
        "— The Focura Team",
      ].join("\n") + plainTextFooter(),
      attachments: [
        {
          filename: fileName,
          content: json,
          contentType: "application/json",
        },
      ],
    });
  } catch (error) {
    console.error(`[email] Failed to send data export to ${toEmail}:`, error);
    throw error;
  }
}
