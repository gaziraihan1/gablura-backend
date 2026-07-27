import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

import nodemailer from 'nodemailer';

describe('sendInvitationEmail', () => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });

  beforeEach(() => {
    vi.resetModules(); // Clear cached module state (including _transporter)
    vi.clearAllMocks();
    process.env.CLIENT_URL = 'http://localhost:3000';
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_USER = 'user@test.com';
    process.env.SMTP_PASS = 'pass';
    (nodemailer.createTransport as any).mockReturnValue({ sendMail: mockSendMail });
  });

  async function getSendInvitationEmail() {
    return (await import('../../../utils/email.js')).sendInvitationEmail;
  }

  it('should send an HTML email with the invitation link', async () => {
    const sendInvitationEmail = await getSendInvitationEmail();
    const email = 'test@example.com';
    const invitation = { token: 'test-token', senderName: 'Alice', workspaceName: 'Acme Corp' };

    await sendInvitationEmail(email, invitation);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: 'Alice invited you to join Acme Corp on Focura',
        html: expect.stringContaining('Acme Corp'),
        text: expect.stringContaining('Acme Corp'),
      }),
    );
  });

  it('should include the invitation link in the email body', async () => {
    const sendInvitationEmail = await getSendInvitationEmail();
    const email = 'guest@example.com';
    const invitation = { token: 'token-123' };

    await sendInvitationEmail(email, invitation);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('http://localhost:3000/invitations/token-123'),
        text: expect.stringContaining('http://localhost:3000/invitations/token-123'),
      }),
    );
  });

  it('should use defaults when senderName and workspaceName are missing', async () => {
    const sendInvitationEmail = await getSendInvitationEmail();
    const email = 'guest@example.com';
    const invitation = { token: 'token-456' };

    await sendInvitationEmail(email, invitation);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('A Focura user'),
        html: expect.stringContaining('a workspace'),
      }),
    );
  });

  it('should fall back to console.log when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.CLIENT_URL = 'http://localhost:3000';

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sendInvitationEmail = await getSendInvitationEmail();
    const email = 'test@example.com';
    const invitation = { token: 'console-token' };

    await sendInvitationEmail(email, invitation);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:3000/invitations/console-token'),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should include the Accept Invitation button in HTML', async () => {
    const sendInvitationEmail = await getSendInvitationEmail();
    const email = 'user@example.com';
    const invitation = { token: 'btn-token', senderName: 'Bob', workspaceName: 'Team WS' };

    await sendInvitationEmail(email, invitation);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Accept Invitation'),
      }),
    );
  });
});
