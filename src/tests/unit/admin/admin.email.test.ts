import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nodemailer so the transporter functions return null (no SMTP configured)
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

describe('admin.email', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Clear SMTP env vars so transporter returns null (skip sending)
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.CLIENT_URL = 'https://gablura.app';
  });

  describe('sendWorkspaceDeletedEmail', () => {
    it('should log a warning and skip when SMTP is not configured (hard delete)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { sendWorkspaceDeletedEmail } = await import('../../../admin/admin.email.js');

      await sendWorkspaceDeletedEmail({
        toEmail: 'owner@test.com',
        toName: 'Alice',
        workspaceName: 'Acme Corp',
        hardDelete: true,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping workspace deleted email'),
      );
      consoleSpy.mockRestore();
    });

    it('should log a warning and skip when SMTP is not configured (soft delete)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { sendWorkspaceDeletedEmail } = await import('../../../admin/admin.email.js');

      await sendWorkspaceDeletedEmail({
        toEmail: 'owner@test.com',
        toName: 'Bob',
        workspaceName: 'Beta Inc',
        hardDelete: false,
        reason: 'ToS violation',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping workspace deleted email'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('sendBanEmail', () => {
    it('should log a warning and skip when SMTP is not configured', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { sendBanEmail } = await import('../../../admin/admin.email.js');

      await sendBanEmail({
        toEmail: 'user@test.com',
        toName: 'Charlie',
        reason: 'Spam',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping ban email'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('sendWorkspaceLimitsChangedEmail', () => {
    it('should log a warning and skip when SMTP is not configured', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { sendWorkspaceLimitsChangedEmail } = await import('../../../admin/admin.email.js');

      await sendWorkspaceLimitsChangedEmail({
        toEmail: 'owner@test.com',
        toName: 'Alice',
        workspaceName: 'Acme Corp',
        changes: [{ label: 'Plan', from: 'PRO', to: 'ENTERPRISE' }],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping workspace limits email'),
      );
      consoleSpy.mockRestore();
    });
  });
});

// ─── Template builder unit tests (no SMTP needed) ────────────────────────────

describe('admin.email template builders', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CLIENT_URL = 'https://gablura.app';
  });

  describe('workspace deleted HTML', () => {
    it('should include permanent deletion text in hard delete HTML', async () => {
      const { sendWorkspaceDeletedEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      // Set SMTP env vars and mock transporter
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendWorkspaceDeletedEmail({
        toEmail: 'owner@test.com',
        toName: 'Alice',
        workspaceName: 'Acme Corp',
        hardDelete: true,
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('permanently deleted'),
          text: expect.stringContaining('permanently deleted'),
        }),
      );
    });

    it('should include suspension text in soft delete HTML', async () => {
      const { sendWorkspaceDeletedEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendWorkspaceDeletedEmail({
        toEmail: 'owner@test.com',
        toName: 'Bob',
        workspaceName: 'Beta Inc',
        hardDelete: false,
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('suspended'),
          text: expect.stringContaining('suspended'),
        }),
      );
    });

    it('should include the reason when provided', async () => {
      const { sendWorkspaceDeletedEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendWorkspaceDeletedEmail({
        toEmail: 'owner@test.com',
        toName: 'Carol',
        workspaceName: 'Gamma LLC',
        hardDelete: false,
        reason: 'Inactive account',
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Inactive account'),
          text: expect.stringContaining('Inactive account'),
        }),
      );
    });
  });

  describe('ban HTML', () => {
    it('should include the ban reason in the email body', async () => {
      const { sendBanEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendBanEmail({
        toEmail: 'user@test.com',
        toName: 'Dave',
        reason: 'Harassment',
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Harassment'),
          text: expect.stringContaining('Harassment'),
          subject: 'Your Gablura account has been suspended',
        }),
      );
    });

    it('should contain the user greeting in the HTML body', async () => {
      const { sendBanEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendBanEmail({
        toEmail: 'user@test.com',
        toName: 'Eve',
        reason: 'Policy violation',
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Hi Eve'),
        }),
      );
    });
  });

  describe('workspace limits changed HTML', () => {
    it('should include the workspace name in the subject and changes in the body', async () => {
      const { sendWorkspaceLimitsChangedEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendWorkspaceLimitsChangedEmail({
        toEmail: 'owner@test.com',
        toName: 'Grace',
        workspaceName: 'Acme Corp',
        changes: [
          { label: 'Plan', from: 'PRO', to: 'ENTERPRISE' },
          { label: 'AI calls per day', from: 'default', to: '9,000' },
        ],
      });

      const sent = sendMail.mock.calls[0][0];
      expect(sent.subject).toContain('Acme Corp');
      expect(sent.html).toContain('AI calls per day');
      expect(sent.html).toContain('9,000');
      expect(sent.text).toContain('Plan: PRO → ENTERPRISE');
    });
  });

  describe('base wrapper', () => {
    it('should include Gablura branding in the footer', async () => {
      const { sendBanEmail } = await import('../../../admin/admin.email.js');
      const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'pass';

      const nodemailer = await import('nodemailer');
      (nodemailer.default.createTransport as any).mockReturnValue({ sendMail });

      await sendBanEmail({
        toEmail: 'user@test.com',
        toName: 'Frank',
        reason: 'Test',
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Gablura'),
        }),
      );
    });
  });
});
