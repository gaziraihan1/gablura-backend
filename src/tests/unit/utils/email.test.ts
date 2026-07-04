import { describe, it, expect, vi } from 'vitest';
import { sendInvitationEmail } from '../../../utils/email.js';

describe('sendInvitationEmail', () => {
  it('should log the correct invitation link', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.CLIENT_URL = 'http://localhost:3000';
    
    const email = 'test@example.com';
    const invitation = { token: 'test-token' };
    
    await sendInvitationEmail(email, invitation);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      'Send email to test@example.com: http://localhost:3000/invitations/test-token'
    );
    
    consoleSpy.mockRestore();
  });
});
