import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('argon2', () => ({ verify: vi.fn() }));

vi.mock('../../lib/totp.js', () => ({
  generateTOTPSecret: vi.fn().mockReturnValue('MOCKBASE32SECRET'),
  createTOTPURI: vi.fn().mockReturnValue('otpauth://totp/Gablura:test@test.com?secret=MOCKBASE32SECRET&issuer=Gablura'),
  verifyTOTPToken: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { setupTwoFactor, verifyTwoFactor, disableTwoFactor } from '../../controllers/twoFactor.controller.js';

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe('setupTwoFactor', () => {
  let req: any, res: any;
  beforeEach(() => {
    vi.clearAllMocks();
    req = { user: { id: 'user-1' } };
    res = mockRes();
  });

  it('returns 401 if not authenticated', async () => {
    await setupTwoFactor({ user: undefined } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 404 if user not found', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await setupTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 if 2FA already enabled', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: true, email: 't@t.com' } as any);
    await setupTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 on success', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: false, email: 't@t.com' } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
    await setupTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('stores the secret in database', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: false, email: 't@t.com' } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
    await setupTwoFactor(req, res);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { twoFactorSecret: 'MOCKBASE32SECRET' },
    });
  });
});

describe('verifyTwoFactor', () => {
  let req: any, res: any;
  beforeEach(() => {
    vi.clearAllMocks();
    req = { user: { id: 'user-1' }, body: {} };
    res = mockRes();
  });

  it('returns 401 if not authenticated', async () => {
    await verifyTwoFactor({ user: undefined, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 if token is missing', async () => {
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 if token not 6 digits', async () => {
    req.body.token = 'abc';
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 if user not found', async () => {
    req.body.token = '123456';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 if 2FA already enabled', async () => {
    req.body.token = '123456';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: 'sec' } as any);
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 if no setup in progress', async () => {
    req.body.token = '123456';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: null } as any);
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 if token is invalid', async () => {
    req.body.token = '123456';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: 'sec' } as any);
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 on valid token', async () => {
    req.body.token = '123456';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: false, twoFactorSecret: 'sec' } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
    const { verifyTOTPToken } = await import('../../lib/totp.js');
    vi.mocked(verifyTOTPToken).mockResolvedValue(true);
    await verifyTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('disableTwoFactor', () => {
  let req: any, res: any;
  beforeEach(() => {
    vi.clearAllMocks();
    req = { user: { id: 'user-1' }, body: {} };
    res = mockRes();
  });

  it('returns 401 if not authenticated', async () => {
    await disableTwoFactor({ user: undefined, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 if password missing', async () => {
    await disableTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 if user not found', async () => {
    req.body.password = 'test123';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await disableTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 400 if 2FA not enabled', async () => {
    req.body.password = 'test123';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: false } as any);
    await disableTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 for OAuth users (no password check)', async () => {
    req.body.password = 'anything';
    const { prisma } = await import('../../lib/prisma.js');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ twoFactorEnabled: true, password: null } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
    await disableTwoFactor(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
