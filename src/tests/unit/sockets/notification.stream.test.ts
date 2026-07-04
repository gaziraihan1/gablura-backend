import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationStreamHandler, getLocalConnectionCount, resetLocalClients } from '../../../sockets/notification.stream.js';
import { verifyToken } from '../../../lib/auth/backendToken.js';
import { getSubscriber } from '../../../lib/redis/redis.pubsub.js';
// import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('../../../lib/auth/backendToken.js', () => ({
  verifyToken: vi.fn(),
}));

vi.mock('../../../lib/redis/redis.pubsub.js', () => {
  const mockSubscriber = {
    on: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  return {
    getSubscriber: vi.fn(() => mockSubscriber),
  };
});

describe('notificationStreamHandler', () => {
  let mockReq: any;
  let mockRes: any;
  let mockSubscriber: any;

  beforeEach(() => {
    vi.resetAllMocks();
    resetLocalClients();
    mockSubscriber = getSubscriber();

    mockReq = {
      query: {},
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

  it('should return 401 if token is missing', async () => {
    mockReq.query.token = undefined;
    await notificationStreamHandler(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Missing token' }));
  });

  it('should return 401 if token is invalid', async () => {
    mockReq.query.token = 'invalid-token';
    (verifyToken as any).mockImplementation(() => {
      throw new Error('Invalid token');
    });
    await notificationStreamHandler(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired token' }));
  });

  it('should establish SSE connection for valid token', async () => {
    mockReq.query.token = 'valid-token';
    (verifyToken as any).mockReturnValue({ id: 'user-123' });
    
    // Mock successful redis subscription
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));

    await notificationStreamHandler(mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(mockRes.flushHeaders).toHaveBeenCalled();
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('connected'));
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('user-123'));
    expect(mockSubscriber.subscribe).toHaveBeenCalled();
  });

  it('should handle redis subscription error gracefully', async () => {
    mockReq.query.token = 'valid-token';
    (verifyToken as any).mockReturnValue({ id: 'user-123' });
    
    // Mock redis subscription failure
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(new Error('Redis Error')));

    await notificationStreamHandler(mockReq, mockRes);

    // Should still write "connected" as per the implementation's catch block
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('connected'));
  });

  it('should remove client on request close', async () => {
    mockReq.query.token = 'valid-token';
    (verifyToken as any).mockReturnValue({ id: 'user-123' });
    mockSubscriber.subscribe.mockImplementation((channel: any, cb: any) => cb(null));

    await notificationStreamHandler(mockReq, mockRes);
    
    const closeHandler = mockReq.on.mock.calls.find((call: any) => call[0] === 'close')[1];
    closeHandler();

    expect(getLocalConnectionCount()).toBe(0);
  });

  it('should handle multiple clients for same user', async () => {
    mockReq.query.token = 'valid-token';
    (verifyToken as any).mockReturnValue({ id: 'user-123' });
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
});
