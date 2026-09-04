import nodemailer from "nodemailer";

// ─── Custom error class ───────────────────────────────────────────────────────

export class EmailSendError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EmailSendError";
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

export function getFromAddress(): string {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@gablura.app";
}

export function getClientUrl(): string {
  return process.env.CLIENT_URL || process.env.FRONTEND_URL || "https://gablura.app";
}

// ─── Singleton transporter (SMTP_* env vars) ────────────────────────────────

let _smtpTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function createSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/**
 * Returns a cached SMTP transporter, or null if SMTP is not configured.
 * Resets the cached instance on connection/auth errors.
 */
export function getSmtpTransporter() {
  if (!_smtpTransporter) {
    _smtpTransporter = createSmtpTransporter();
  }
  return _smtpTransporter;
}

/**
 * Resets the cached SMTP transporter so the next call to `getSmtpTransporter()`
 * creates a fresh instance. Useful after connection/auth failures.
 */
export function resetSmtpTransporter(): void {
  _smtpTransporter = null;
}

// ─── Base HTML wrapper ───────────────────────────────────────────────────────

export function baseWrapper(content: string): string {
  const year = new Date().getFullYear();
  const clientUrl = getClientUrl();
  const displayUrl = clientUrl.replace(/^https?:\/\//, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gablura</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;border-radius:12px 12px 0 0;padding:28px 36px;">
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Gablura</span>
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
                \u00a9 ${year} Gablura \u00b7
                <a href="${clientUrl}" style="color:#a3a3a3;">${displayUrl}</a>
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

// ─── Plain-text footer ───────────────────────────────────────────────────────

export function plainTextFooter(): string {
  const year = new Date().getFullYear();
  const clientUrl = getClientUrl();
  return `\n\n\u2014\n\u00a9 ${year} Gablura \u00b7 ${clientUrl}`;
}

// ─── HTML escaping (lightweight, no dependency) ──────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
