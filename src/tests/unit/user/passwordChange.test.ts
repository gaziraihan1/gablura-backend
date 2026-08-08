import { describe, it, expect, beforeEach, vi } from 'vitest';
import { changePassword } from '../../../controllers/user.controller.js';
import { prisma } from '../../../lib/prisma.js';
import argon2 from 'argon2';

// Mock dependencies
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../lib/redis/cache.client.js', () => ({
  UserCache: {
    invalidateProfile: vi.fn(),
  },
}));

vi.mock('argon2', () => ({
  default: {
    verify: vi.fn(),
    hash: vi.fn(),
  },
}));

describe('changePassword', () => {
  const mockUserId = 'user-123';
  const mockCurrentPassword = 'OldPassword123!';
  const mockNewPassword = 'NewPassword456!';
  const hashedPassword = '$argon2id$v=19$m=65536$t=3$p=4$hashedpassword';

  const mockReq = {
    user: { id: mockUserId },
    body: {
      currentPassword: mockCurrentPassword,
      newPassword: mockNewPassword,
    },
  } as any;

  const mockRes = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes.status.mockReturnThis();
    mockRes.json.mockImplementation(() => {});
  });

  it('should return 401 if user is not authenticated', async () => {
    const req = { user: undefined, body: mockReq.body } as any;
    await changePassword(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Unauthorized',
    });
  });

  it('should return 400 if current password is missing', async () => {
    const req = { ...mockReq, body: { newPassword: mockNewPassword } } as any;
    await changePassword(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Current password and new password are required',
    });
  });

  it('should return 400 if new password is missing', async () => {
    const req = { ...mockReq, body: { currentPassword: mockCurrentPassword } } as any;
    await changePassword(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Current password and new password are required',
    });
  });

  it('should return 400 if new password is too short', async () => {
    const req = { ...mockReq, body: { currentPassword: mockCurrentPassword, newPassword: '1234567' } } as any;
    await changePassword(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'New password must be at least 8 characters',
    });
  });

  it('should return 400 if new password is too long', async () => {
    const req = { ...mockReq, body: { currentPassword: mockCurrentPassword, newPassword: 'a'.repeat(129) } } as any;
    await changePassword(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'New password must be less than 128 characters',
    });
  });

  it('should return 400 if new password is same as current', async () => {
    const req = { ...mockReq, body: { currentPassword: mockCurrentPassword, newPassword: mockCurrentPassword } } as any;
    await changePassword(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'New password must be different from current password',
    });
  });

  it('should return 404 if user not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await changePassword(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'User not found',
    });
  });

  it('should return 400 if user has no password (OAuth account)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: mockUserId, password: null } as any);
    await changePassword(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'This account uses social login. Please set a password through the account settings.',
    });
  });

  it('should return 401 if current password is incorrect', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: mockUserId, password: hashedPassword } as any);
    vi.mocked(argon2.verify).mockResolvedValue(false);
    await changePassword(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Current password is incorrect',
    });
  });

  it('should change password successfully', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: mockUserId, password: hashedPassword } as any);
    vi.mocked(argon2.verify).mockResolvedValue(true);
    vi.mocked(argon2.hash).mockResolvedValue('$argon2id$v=19$m=65536$t=3$p=4$newhash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await changePassword(mockReq, mockRes);

    expect(argon2.verify).toHaveBeenCalledWith(hashedPassword, mockCurrentPassword);
    expect(argon2.hash).toHaveBeenCalledWith(mockNewPassword);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: mockUserId },
      data: {
        password: '$argon2id$v=19$m=65536$t=3$p=4$newhash',
        lastPasswordChange: expect.any(Date),
      },
    });
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      message: 'Password changed successfully',
    });
  });

  it('should handle database errors gracefully', async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Database error'));
    await changePassword(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Failed to change password',
    });
  });
});
