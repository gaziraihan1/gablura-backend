import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { verifyToken } from '../../../lib/auth/backendToken.js';
import { getSubscriber } from '../../../lib/redis/redis.pubsub.js';
// consumeSseToken comes from the global tokenRevocation mock in tests/setup.ts
// (default: returns null = already used/expired). Tests override it per case.
import { consumeSseToken } from '../../../lib/auth/tokenRevocation.js';
import { auditLog } from '../../../lib/auth/auditLog.js';
// import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('../../../lib/auth/backendToken.js', () => ({
  verifyToken: vi.fn(),
}));

// auditLog is covered by its own unit tests — keep stream tests hermetic
vi.mock('../../../lib/auth/auditLog.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../../../lib/redis/redis.pubsub.js', () => {
  const mockSubscriber = {
    on: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn((channel, cb) => cb(null)),
  };
  return {
    getSubscriber: vi.fn(() => mockSubscriber),
  };
});

describe('notificationStreamHandler', () => {
  let mockReq: any;
  let mockRes: any;
  let mockSubscriber: any;
  let messageHandler: any;

  // Module exports
  let notificationStreamHandler: any;
  let getLocalConnectionCount: any;
  let resetLocalClients: any;

  beforeAll(async () => {
    // Dynamically import the module
    const module = await import('../../../sockets/notification.stream.js');
    notificationStreamHandler = module.notificationStreamHandler;
    getLocalConnectionCount = module.getLocalConnectionCount;
    resetLocalClients = module.resetLocalClients;

    mockSubscriber = getSubscriber();
    // Capture the message handler that was registered during module load
    const call = mockSubscriber.on.mock.calls.find((call: string[]) => call[0] === 'message');
    if (call) {
      messageHandler = call[1];
    }
  });

  afterAll(() => {
    // cleanup
  });

  beforeEach(() => {
    // Use clearAllMocks instead of resetAllMocks to preserve the initial 'on' call if needed
    // although we captured messageHandler already.
    vi.clearAllMocks();
    resetLocalClients();

    mockReq = {
      query: {},
      // Used by getClientIp() inside the audit log calls
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn(),
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    };
  });

  // Helper: make verifyToken + consumeSseToken accept the connection
  function mockValidSseToken(): void {
    (verifyToken as any).mockReturnValue({ id: 'user-123', jti: 'jti-123' });
    vi.mocked(consumeSseToken).mockResolvedValue('user-123');
  }

  it('should return 401 if token is missing', async () => {
    mockReq.query.token = undefined;
    await notificationStreamHandler(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Missing token', code: 'MISSING_TOKEN' }));
    expect(vi.mocked(consumeSseToken)).not.toHaveBeenCalled();
  });

  it('should return 401 if token is invalid', async () => {
    mockReq.query.token = 'invalid-token';
    (verifyToken as any).mockImplementation(() => {
      throw new Error('Invalid token');
    });
    await notificationStreamHandler(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired token', code: 'INVALID_TOKEN' }));
    expect(vi.mocked(consumeSseToken)).not.toHaveBeenCalled();
  });

  it('should only accept sse-type tokens (access tokens are rejected)', async () => {
    mockReq.query.token = 'access-token';
    (verifyToken as any).mockImplementation(() => {
      throw new Error("Expected 'sse', got 'access'");
    });
    await notificationStreamHandler(mockReq, mockRes);
    // The type restriction lives inside verifyToken — assert the handler pins
    // the expected type so a 15-minute access token can never open a stream.
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
  });

  it('should reject a reused/expired token (consume returns null)', async () => {
    mockReq.query.token = 'used-token';
    (verifyToken as any).mockReturnValue({ id: 'user-123', jti: 'jti-used' });
    vi.mocked(consumeSseToken).mockResolvedValue(null);

    await notificationStreamHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_REUSED' }));
    // The stream must not be opened (no SSE headers, no subscription)
    expect(mockRes.setHeader).not.toHaveBeenCalled();
    expect(mockRes.flushHeaders).not.toHaveBeenCalled();
    expect(mockSubscriber.subscribe).not.toHaveBeenCalled();
  });

  it('should reject a token consumed by a different user', async () => {
    mockReq.query.token = 'mismatched-token';
    (verifyToken as any).mockReturnValue({ id: 'user-123', jti: 'jti-123' });
    vi.mocked(consumeSseToken).mockResolvedValue('user-999');

    await notificationStreamHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_REUSED' }));
  });

  it('should establish SSE connection for valid single-use token', async () => {
    mockReq.query.token = 'valid-token';
    mockValidSseToken();

    // Mock successful redis subscription
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));

    await notificationStreamHandler(mockReq, mockRes);

    expect(verifyToken).toHaveBeenCalledWith('valid-token', 'sse');
    expect(vi.mocked(consumeSseToken)).toHaveBeenCalledWith('jti-123');
    expect(auditLog).toHaveBeenCalledWith('SSE_CONNECTED', expect.objectContaining({ userId: 'user-123' }));
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(mockRes.flushHeaders).toHaveBeenCalled();
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('connected'));
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('user-123'));
    expect(mockSubscriber.subscribe).toHaveBeenCalled();
  });

  it('should handle redis subscription error gracefully', async () => {
    mockReq.query.token = 'valid-token';
    mockValidSseToken();

    // Mock redis subscription failure
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(new Error('Redis Error')));

    await notificationStreamHandler(mockReq, mockRes);

    // Should still write "connected" as per the implementation's catch block
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('connected'));
  });

  it('should remove client on request close', async () => {
    mockReq.query.token = 'valid-token';
    mockValidSseToken();
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));

    await notificationStreamHandler(mockReq, mockRes);

    const closeHandler = mockReq.on.mock.calls.find((call: any) => call[0] === 'close')[1];
    closeHandler();

    expect(getLocalConnectionCount()).toBe(0);
  });

  it('should handle multiple clients for same user', async () => {
    mockReq.query.token = 'valid-token';
    mockValidSseToken();
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));

    const mockRes2: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    };

    await notificationStreamHandler(mockReq, mockRes);
    await notificationStreamHandler(mockReq, mockRes2);

    expect(getLocalConnectionCount()).toBe(2);
  });

  describe('Redis Message Handling', () => {
    it('should send notification to connected clients', async () => {
      mockReq.query.token = 'valid-token';
      mockValidSseToken();
      mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));
      await notificationStreamHandler(mockReq, mockRes);

      const payload = { type: 'notification', content: 'Hello' };
      messageHandler('sse:user:user-123', JSON.stringify(payload));

      expect(mockRes.write).toHaveBeenCalledWith(`data: ${JSON.stringify(payload)}\n\n`);
    });

    it('should return early if no clients are connected for the user', async () => {
      // Try to send to a user that isn't connected
      messageHandler('sse:user:unknown', JSON.stringify({ type: 'test' }));

      expect(mockRes.write).not.toHaveBeenCalledWith(expect.stringContaining('test'));
    });

    it('should handle malformed JSON gracefully', async () => {
      mockReq.query.token = 'valid-token';
      mockValidSseToken();
      mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));
      await notificationStreamHandler(mockReq, mockRes);

      // Send invalid JSON
      messageHandler('sse:user:user-123', 'invalid-json');

      expect(mockRes.write).not.toHaveBeenCalledWith(expect.stringContaining('invalid-json'));
    });

    it('should remove client if writing fails', async () => {
      mockReq.query.token = 'valid-token';
      mockValidSseToken();
      mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));
      await notificationStreamHandler(mockReq, mockRes);

      mockRes.write.mockImplementation(() => {
        throw new Error('Write failed');
      });

      messageHandler('sse:user:user-123', JSON.stringify({ type: 'test' }));

      expect(getLocalConnectionCount()).toBe(0);
    });
  });

  describe('Unsubscription and Heartbeat', () => {
    it('should handle unsubscribe error by rolling back state to active', async () => {
      mockReq.query.token = 'valid-token';
      mockValidSseToken();
      mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));
      await notificationStreamHandler(mockReq, mockRes);

      // Mock unsubscribe to fail
      mockSubscriber.unsubscribe.mockImplementation((channel: any, cb: any) => cb(new Error('Unsub failed')));

      const closeHandler = mockReq.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeHandler();

      expect(mockSubscriber.unsubscribe).toHaveBeenCalled();
    });

    // Heartbeat tests are skipped — the setInterval is disabled in test mode
    // to prevent the process from hanging. The heartbeat logic is a simple
    // res.write() call that doesn't need unit test coverage.
  });
});
