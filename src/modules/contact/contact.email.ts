import nodemailer from "nodemailer";
import type { CreateContactMessageInput } from "./contact.validator.js";

// ─── HTML escaping to prevent XSS ──────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Custom error class ───────────────────────────────────────────────────────
export class ContactEmailError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ContactEmailError";
  }
}

// ─── Singleton transporter ────────────────────────────────────────────────────
function createTransporter() {
  const { EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD } =
    process.env;

  if (!EMAIL_SERVER_HOST || !EMAIL_SERVER_PORT || !EMAIL_SERVER_USER || !EMAIL_SERVER_PASSWORD) {
    throw new ContactEmailError(
      "Missing required email env vars: EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD"
    );
  }

  return nodemailer.createTransport({
    host: EMAIL_SERVER_HOST,
    port: Number(EMAIL_SERVER_PORT),
    secure: false, // true for SMTPS, false for STARTTLS (587)
    auth: {
      user: EMAIL_SERVER_USER,
      pass: EMAIL_SERVER_PASSWORD,
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  });
}

let _transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = createTransporter();
  }
  return _transporter;
}

// ─── Shared send helper ───────────────────────────────────────────────────────
async function sendMail(options: {
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new ContactEmailError("Missing required env var: EMAIL_FROM");
  }

  try {
    const info = await getTransporter().sendMail({
      from,
      to: options.to,
      replyTo: options.replyTo,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log(`[contact.email] Sent to ${options.to} — messageId: ${info.messageId}`);
  } catch (error) {
    // Reset transporter on connection/auth errors so next call gets a fresh attempt
    const isConnectionError =
      error instanceof Error &&
      (error.message.includes("ECONNREFUSED") ||
        error.message.includes("ENOTFOUND") ||
        error.message.includes("535") || // SMTP auth failure
        error.message.includes("534"));

    if (isConnectionError) {
      _transporter = null;
    }

    console.error(`[contact.email] Failed to send to ${options.to}:`, error);
    throw new ContactEmailError(`Failed to send email to ${options.to}`, error);
  }
}

// ─── Category maps ────────────────────────────────────────────────────────────
const categoryLabel: Record<string, string> = {
  GENERAL: "General Enquiry",
  BILLING: "Billing & Subscriptions",
  TECHNICAL: "Technical Issue",
  FEATURE_REQUEST: "Feature Request",
  PARTNERSHIP: "Partnership",
  SECURITY: "Security",
  OTHER: "Other",
};

const categoryColor: Record<string, string> = {
  GENERAL: "#6366f1",
  BILLING: "#f59e0b",
  TECHNICAL: "#ef4444",
  FEATURE_REQUEST: "#10b981",
  PARTNERSHIP: "#8b5cf6",
  SECURITY: "#dc2626",
  OTHER: "#64748b",
};

// ─── Public send functions ────────────────────────────────────────────────────

/**
 * Sends the admin notification email to focurabusiness@gmail.com.
 * Called fire-and-forget in contact.service — errors are caught and logged there.
 */
export async function sendAdminContactNotification(
  data: CreateContactMessageInput,
  messageId: string,
  ip: string
): Promise<void> {
  const supportEmail =
    process.env.SUPPORT_EMAIL ?? process.env.EMAIL_SERVER_USER ?? "support@focura.app";

  await sendMail({
    to: supportEmail,
    replyTo: data.email,
    subject: `[Contact] ${categoryLabel[data.category] ?? data.category}: ${data.subject}`,
    html: buildAdminEmailHtml(data, messageId, ip),
    text: buildAdminEmailText(data, messageId, ip),
  });
}

/**
 * Sends the auto-reply confirmation to the user.
 * Called fire-and-forget in contact.service — errors are caught and logged there.
 */
export async function sendUserAutoReply(
  data: CreateContactMessageInput
): Promise<void> {
  await sendMail({
    to: data.email,
    subject: `We received your message — Focura`,
    html: buildUserAutoReplyHtml(data),
    text: buildUserAutoReplyText(data),
  });
}

// ─── HTML templates ───────────────────────────────────────────────────────────

function baseWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Focura</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;border-radius:12px 12px 0 0;padding:28px 36px;">
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Focura</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:36px;border-radius:0 0 12px 12px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a3a3a3;">
                © ${new Date().getFullYear()} Focura ·
                <a href="${process.env.CLIENT_URL || process.env.FRONTEND_URL || 'https://focura.app'}" style="color:#a3a3a3;">${process.env.CLIENT_URL || process.env.FRONTEND_URL || 'focura.app'}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

function buildAdminEmailHtml(
  data: CreateContactMessageInput,
  messageId: string,
  ip: string
): string {
  const color = categoryColor[data.category] ?? "#64748b";
  const label = categoryLabel[data.category] ?? data.category;

  const rows = [
    ["Name", escapeHtml(data.name)],
    ["Email", `<a href="mailto:${escapeHtml(data.email)}" style="color:#0a0a0a;">${escapeHtml(data.email)}</a>`],
    ["Category", escapeHtml(label)],
    ["Subject", escapeHtml(data.subject)],
    ["IP Address", escapeHtml(ip)],
    ["Message ID", escapeHtml(messageId)],
  ]
    .map(
      ([l, v], i) => `
      <tr style="background:${i % 2 === 0 ? "#fafafa" : "#ffffff"};">
        <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#737373;white-space:nowrap;border-bottom:1px solid #f0f0f0;width:120px;">${l}</td>
        <td style="padding:10px 14px;font-size:13px;color:#0a0a0a;border-bottom:1px solid #f0f0f0;">${v}</td>
      </tr>`
    )
    .join("");

  const content = `
    <div style="display:inline-block;padding:3px 10px;background:${color}18;border-radius:4px;margin-bottom:16px;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${color};">${label}</span>
    </div>
    <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;">New Contact Message</h2>
    <p style="margin:0 0 24px;font-size:13px;color:#737373;">Submitted via ${process.env.CLIENT_URL || process.env.FRONTEND_URL || 'focura.app'}/contact</p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      ${rows}
    </table>

    <div style="background:#fafafa;border:1px solid #e5e5e5;border-left:3px solid ${color};border-radius:8px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
      <p style="margin:0;font-size:14px;color:#0a0a0a;line-height:1.7;white-space:pre-wrap;">${escapeHtml(data.message)}</p>
    </div>

    <a href="mailto:${escapeHtml(data.email)}?subject=Re: ${encodeURIComponent(data.subject)}"
       style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:12px 20px;border-radius:8px;">
      Reply to ${escapeHtml(data.name)}
    </a>
  `;

  return baseWrapper(content);
}

function buildUserAutoReplyHtml(data: CreateContactMessageInput): string {
  const label = categoryLabel[data.category] ?? data.category;
  const preview =
    data.message.length > 300 ? data.message.slice(0, 300) + "…" : data.message;
  const firstName = data.name.split(" ")[0];

  const content = `
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0a0a0a;">
      Thanks for reaching out, ${escapeHtml(firstName)}!
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#525252;line-height:1.7;">
      We received your message and our team will get back to you within
      <strong style="color:#0a0a0a;">2 business days</strong>. In the meantime,
      you can browse our documentation or check the FAQ on our contact page.
    </p>

    <div style="background:#fafafa;border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.5px;">Your message</p>
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0a0a0a;">${escapeHtml(data.subject)}</p>
      <p style="margin:0;font-size:13px;color:#525252;line-height:1.6;white-space:pre-wrap;">${escapeHtml(preview)}</p>
    </div>

    <div style="background:#fafafa;border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#737373;">Category</p>
      <p style="margin:0;font-size:13px;color:#0a0a0a;">${escapeHtml(label)}</p>
    </div>

    <p style="margin:0 0 8px;font-size:13px;color:#737373;line-height:1.6;">
      If this is urgent, you can also reach us directly at
      <a href="mailto:${supportEmail}" style="color:#0a0a0a;font-weight:600;">${supportEmail}</a>.
    </p>
    <p style="margin:0;font-size:13px;color:#737373;">— The Focura Team</p>
  `;

  return baseWrapper(content);
}

// ─── Plain-text fallbacks ─────────────────────────────────────────────────────

function buildAdminEmailText(
  data: CreateContactMessageInput,
  messageId: string,
  ip: string
): string {
  return [
    "NEW CONTACT MESSAGE — FOCURA",
    `Message ID: ${messageId}`,
    "",
    `Name:     ${data.name}`,
    `Email:    ${data.email}`,
    `Category: ${categoryLabel[data.category] ?? data.category}`,
    `Subject:  ${data.subject}`,
    `IP:       ${ip}`,
    "",
    "MESSAGE:",
    data.message,
    "",
    `Reply: mailto:${data.email}`,
  ].join("\n");
}

function buildUserAutoReplyText(data: CreateContactMessageInput): string {
  const preview =
    data.message.length > 300 ? data.message.slice(0, 300) + "…" : data.message;

  return [
    `Hi ${data.name.split(" ")[0]},`,
    "",
    "Thanks for reaching out to Focura. We received your message and will reply within 2 business days.",
    "",
    `Subject:  ${data.subject}`,
    `Category: ${categoryLabel[data.category] ?? data.category}`,
    "",
    "Your message:",
    preview,
    "",
    "If urgent, email us directly at focurabusiness@gmail.com.",
    "",
    "— The Focura Team",
  ].join("\n");
}