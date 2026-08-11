import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/admin.config.js', () => ({
  isFocuraAdminUser: vi.fn((role: string, id: string) => role === 'ADMIN' && id === 'admin-user-id'),
}));

import { requireAdminId } from '../../../modules/contact/requireAdminId.js';

describe('requireAdminId', () => {
  const mockReq = (userId?: string, role = 'USER') => ({
    user: userId ? { id: userId, role } : undefined,
  });
  const mockRes = () => {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };
  const mockNext = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('should call next for admin user', () => {
    const req = mockReq('admin-user-id', 'ADMIN');
    const res = mockRes();

    requireAdminId(req as any, res as any, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 403 for non-admin user', () => {
    const req = mockReq('regular-user');
    const res = mockRes();

    requireAdminId(req as any, res as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'FORBIDDEN' }),
    );
  });

  it('should return 403 when user is undefined', () => {
    const req = mockReq(undefined);
    const res = mockRes();

    requireAdminId(req as any, res as any, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
