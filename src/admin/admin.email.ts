import escape from "escape-html";
import {
  getSmtpTransporter,
  getFromAddress,
  baseWrapper,
  plainTextFooter,
} from "../lib/email/shared.js";

function getTransporter() {
  const t = getSmtpTransporter();
  if (!t) {
    console.warn("[admin.email] Missing SMTP env vars — emails will be skipped");
  }
  return t;
}

// ─── HTML templates ──────────────────────────────────────────────────────────

function buildWorkspaceDeletedHtml(params: {
  toName: string;
  workspaceName: string;
  reason?: string;
  hardDelete: boolean;
}): string {
  const { toName, workspaceName, reason, hardDelete } = params;
  const safeName = escape(toName);
  const safeWorkspace = escape(workspaceName);
  const safeReason = reason ? escape(reason) : null;

  if (hardDelete) {
    return baseWrapper(`
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0a0a0a;">Workspace Permanently Deleted</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">
        Your Focura workspace <strong>${safeWorkspace}</strong> has been
        <strong style="color:#dc2626;">permanently deleted</strong> by our admin team.
      </p>
      ${safeReason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;"><p style="margin:0;font-size:13px;color:#991b1b;"><strong>Reason:</strong> ${safeReason}</p></div>` : ""}
      <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">All data associated with this workspace has been removed and cannot be recovered.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#525252;line-height:1.7;">If you believe this was a mistake, please contact support.</p>
      <p style="margin:0;font-size:14px;color:#525252;">— The Focura Team</p>
    `);
  }

  return baseWrapper(`
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0a0a0a;">Workspace Suspended</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">Hi ${safeName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">
      Your Focura workspace <strong>${safeWorkspace}</strong> has been
      <strong style="color:#f59e0b;">suspended</strong> by our admin team.
    </p>
    ${safeReason ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:16px;"><p style="margin:0;font-size:13px;color:#92400e;"><strong>Reason:</strong> ${safeReason}</p></div>` : ""}
    <p style="margin:0 0 8px;font-size:14px;color:#525252;line-height:1.7;">If you believe this was a mistake, please contact support.</p>
    <p style="margin:0;font-size:14px;color:#525252;">— The Focura Team</p>
  `);
}

function buildBanHtml(params: { toName: string; reason: string }): string {
  const { toName, reason } = params;
  const safeName = escape(toName);
  const safeReason = escape(reason);

  return baseWrapper(`
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0a0a0a;">Account Suspended</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">Hi ${safeName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.7;">
      Your Focura account has been <strong style="color:#dc2626;">suspended</strong> by our admin team.
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#991b1b;"><strong>Reason:</strong> ${safeReason}</p>
    </div>
    <p style="margin:0 0 8px;font-size:14px;color:#525252;line-height:1.7;">If you believe this was a mistake, please contact support.</p>
    <p style="margin:0;font-size:14px;color:#525252;">— The Focura Team</p>
  `);
}

// ─── Plain-text fallbacks ────────────────────────────────────────────────────

function buildWorkspaceDeletedText(params: {
  toName: string;
  workspaceName: string;
  reason?: string;
  hardDelete: boolean;
}): string {
  const { toName, workspaceName, reason, hardDelete } = params;
  const lines = hardDelete
    ? [
        `Hi ${toName},`,
        "",
        `Your Focura workspace "${workspaceName}" has been permanently deleted by our admin team.`,
        ...(reason ? [`Reason: ${reason}`, ""] : [""]),
        "All data associated with this workspace has been removed and cannot be recovered.",
        "If you believe this was a mistake, please contact support.",
        "",
        "— The Focura Team",
      ]
    : [
        `Hi ${toName},`,
        "",
        `Your Focura workspace "${workspaceName}" has been suspended by our admin team.`,
        ...(reason ? [`Reason: ${reason}`, ""] : [""]),
        "If you believe this was a mistake, please contact support.",
        "",
        "— The Focura Team",
      ];
  return lines.join("\n") + plainTextFooter();
}

function buildBanText(params: { toName: string; reason: string }): string {
  const { toName, reason } = params;
  return [
    `Hi ${toName},`,
    "",
    "Your Focura account has been suspended by our admin team.",
    `Reason: ${reason}`,
    "",
    "If you believe this was a mistake, please contact support.",
    "",
    "— The Focura Team",
  ].join("\n") + plainTextFooter();
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendWorkspaceDeletedEmail(params: {
  toEmail:       string;
  toName:        string;
  workspaceName: string;
  reason?:       string;
  hardDelete:    boolean;
}): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[admin.email] Skipping workspace deleted email to ${params.toEmail} — SMTP not configured`);
    return;
  }

  const { toEmail } = params;

  try {
    await transporter.sendMail({
      from:    `"Focura" <${getFromAddress()}>`,
      to:      toEmail,
      subject: params.hardDelete
        ? `Your workspace "${params.workspaceName}" has been permanently deleted`
        : `Your workspace "${params.workspaceName}" has been suspended`,
      html:    buildWorkspaceDeletedHtml(params),
      text:    buildWorkspaceDeletedText(params),
    });
  } catch (error) {
    console.error(`[admin.email] Failed to send workspace email to ${toEmail}:`, error);
    throw error;
  }
}

export async function sendBanEmail(params: {
  toEmail:  string;
  toName:   string;
  reason:   string;
}): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[admin.email] Skipping ban email to ${params.toEmail} — SMTP not configured`);
    return;
  }

  const { toEmail } = params;

  try {
    await transporter.sendMail({
      from:    `"Focura" <${getFromAddress()}>`,
      to:      toEmail,
      subject: "Your Focura account has been suspended",
      html:    buildBanHtml(params),
      text:    buildBanText(params),
    });
  } catch (error) {
    console.error(`[admin.email] Failed to send ban email to ${toEmail}:`, error);
    throw error;
  }
}