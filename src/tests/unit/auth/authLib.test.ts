import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request } from "express";

// ─── Mock Redis (vi.hoisted so it exists before vi.mock factories run) ──────
const { mockRedis, getRedisClientMock } = vi.hoisted(() => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    eval: vi.fn(),
    keys: vi.fn(),
    scan: vi.fn(),
    pipeline: vi.fn(),
  };
  return { mockRedis, getRedisClientMock: vi.fn(() => mockRedis) };
});

// ─── Override setup.ts mocks for the modules under test ─────────────────────
// setup.ts globally mocks redis.client.js — we override with our controllable mock
vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: getRedisClientMock,
}));

// setup.ts partially mocks tokenRevocation & refreshLock — override with real impls
vi.mock("../../../lib/auth/tokenRevocation.js", async (importOriginal) => {
  return await importOriginal();
});

vi.mock("../../../lib/auth/refreshLock.js", async (importOriginal) => {
  return await importOriginal();
});

// ─── Imports ────────────────────────────────────────────────────────────────
import { auditLog, AuditEventType } from "../../../lib/auth/auditLog.js";
import {
  generateDeviceFingerprint,
  getClientIp,
  isPrivateIp,
  looksLikeServerToServerRequest,
  looksLikeServerToServerUA,
  createSessionMetadata,
  validateSessionBinding,
  SessionMetadata,
} from "../../../lib/auth/sessionBinding.js";
import {
  recordFailedAttempt,
  clearFailedAttempts,
  isAccountLocked,
} from "../../../lib/auth/accountLockout.js";
import {
  acquireRefreshLock,
  releaseRefreshLock,
  isRefreshLocked,
} from "../../../lib/auth/refreshLock.js";
import {
  trackUserSession,
  revokeUserSession,
  getUserActiveSessions,
} from "../../../lib/auth/sessionManager.js";
import {
  revokeAccessToken,
  isAccessTokenRevoked,
  storeRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  rotateRefreshToken,
  storeSseToken,
  consumeSseToken,
} from "../../../lib/auth/tokenRevocation.js";

// ─── Helpers ────────────────────────────────────────────────────────────────
function mockReq(overrides: Record<string, any> = {}): Request {
  return {
    headers: {
      "user-agent": "TestAgent/1.0",
      "accept-language": "en-US",
      "accept-encoding": "gzip, br",
      ...overrides.headers,
    },
    socket: {
      remoteAddress: overrides.remoteAddress || "127.0.0.1",
    },
  } as unknown as Request;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════════
describe("auditLog", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs critical events to console.error", () => {
    auditLog("TOKEN_REPLAY_DETECTED", { userId: "u1", reason: "replay" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();

    const output = errorSpy.mock.calls[0][0] as string;
    expect(output).toContain("[AUDIT:CRITICAL]");
    expect(output).toContain("TOKEN_REPLAY_DETECTED");
    expect(output).toContain("u1");
  });

  it("logs warn events to console.warn", () => {
    auditLog("LOGIN_FAILED", { ip: "10.0.0.1" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();

    const output = warnSpy.mock.calls[0][0] as string;
    expect(output).toContain("[AUDIT:WARN]");
    expect(output).toContain("LOGIN_FAILED");
  });

  it("logs info events to console.info", () => {
    auditLog("LOGIN_SUCCESS", { userId: "u2" });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    const output = infoSpy.mock.calls[0][0] as string;
    expect(output).toContain("[AUDIT:INFO]");
    expect(output).toContain("LOGIN_SUCCESS");
  });

  it("includes timestamp and all supplied data fields", () => {
    auditLog("LOGOUT", {
      userId: "u3",
      sessionId: "s1",
      ip: "192.168.1.1",
      userAgent: "Browser/1.0",
      meta: { foo: "bar" },
    });

    const output = infoSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.replace("[AUDIT:INFO] ", ""));
    expect(parsed.event).toBe("LOGOUT");
    expect(parsed.userId).toBe("u3");
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.ip).toBe("192.168.1.1");
    expect(parsed.userAgent).toBe("Browser/1.0");
    expect(parsed.meta).toEqual({ foo: "bar" });
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.severity).toBe("info");
  });

  it("sets severity correctly for all critical events", () => {
    const criticalEvents: AuditEventType[] = [
      "TOKEN_REPLAY_DETECTED",
      "ACCOUNT_LOCKED",
      "SESSION_HIJACK_DETECTED",
      "MALWARE_DETECTED",
      "DATA_DELETION",
      "WORKSPACE_DELETED",
    ];

    for (const event of criticalEvents) {
      vi.clearAllMocks();
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      auditLog(event, {});
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain("[AUDIT:CRITICAL]");
    }
  });

  it("sets severity correctly for all warn events", () => {
    const warnEvents: AuditEventType[] = [
      "LOGIN_FAILED",
      "LOGIN_BLOCKED",
      "TOKEN_VERSION_MISMATCH",
      "EXCHANGE_FAILED",
      "PERMISSION_DENIED",
      "EMAIL_NOT_VERIFIED",
      "DEVICE_MISMATCH",
      "SUSPICIOUS_IP_CHANGE",
      "CSRF_VALIDATION_FAILED",
      "UNAUTHORIZED_ACCESS",
      "RATE_LIMIT_EXCEEDED",
      "SUSPICIOUS_ACTIVITY",
      "SENSITIVE_DATA_ACCESS",
      "PAYMENT_FAILED",
      "MAX_SESSIONS_REACHED",
    ];

    for (const event of warnEvents) {
      vi.clearAllMocks();
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      auditLog(event, {});
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const output = warnSpy.mock.calls[0][0] as string;
      expect(output).toContain("[AUDIT:WARN]");
    }
  });

  it("sets severity correctly for all info events", () => {
    const infoEvents: AuditEventType[] = [
      "LOGIN_SUCCESS",
      "LOGOUT",
      "LOGOUT_ALL_DEVICES",
      "TOKEN_REFRESHED",
      "TOKEN_REVOKED",
      "TOKEN_EXPIRED",
      "EXCHANGE_SUCCESS",
      "SSE_CONNECTED",
      "SSE_DISCONNECTED",
      "DATA_EXPORT",
      "WORKSPACE_CREATED",
      "MEMBER_ADDED",
      "MEMBER_REMOVED",
      "ROLE_CHANGED",
      "SUBSCRIPTION_CREATED",
      "SUBSCRIPTION_CANCELLED",
      "SESSION_BOUND",
      "SESSION_REBOUND",
      "SESSION_TIMEOUT",
      "SESSION_REVOKED",
      "SESSIONS_REVOKED",
    ];

    for (const event of infoEvents) {
      vi.clearAllMocks();
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      auditLog(event, {});
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const output = infoSpy.mock.calls[0][0] as string;
      expect(output).toContain("[AUDIT:INFO]");
    }
  });

  it("works with no optional data fields", () => {
    auditLog("LOGOUT", {});
    const output = infoSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.replace("[AUDIT:INFO] ", ""));
    expect(parsed.event).toBe("LOGOUT");
    expect(parsed.userId).toBeUndefined();
    expect(parsed.ip).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SESSION BINDING
// ═══════════════════════════════════════════════════════════════════════════════
describe("sessionBinding", () => {
  describe("generateDeviceFingerprint", () => {
    it("returns a 32-char hex SHA256 hash", () => {
      const fp = generateDeviceFingerprint(mockReq());
      expect(fp).toMatch(/^[a-f0-9]{32}$/);
    });

    it("produces same fingerprint for same input", () => {
      const req = mockReq();
      expect(generateDeviceFingerprint(req)).toBe(
        generateDeviceFingerprint(req)
      );
    });

    it("produces different fingerprint for a different browser family", () => {
      const fp1 = generateDeviceFingerprint(
        mockReq({ headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" } })
      );
      const fp2 = generateDeviceFingerprint(
        mockReq({ headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0" } })
      );
      expect(fp1).not.toBe(fp2);
    });

    it("is stable across browser version updates", () => {
      const fp1 = generateDeviceFingerprint(
        mockReq({ headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" } })
      );
      const fp2 = generateDeviceFingerprint(
        mockReq({ headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" } })
      );
      expect(fp1).toBe(fp2);
    });

    it("distinguishes mobile from desktop", () => {
      const fp1 = generateDeviceFingerprint(
        mockReq({ headers: { "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36" } })
      );
      const fp2 = generateDeviceFingerprint(
        mockReq({ headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" } })
      );
      expect(fp1).not.toBe(fp2);
    });

    it("produces different fingerprint for different accept-language", () => {
      const fp1 = generateDeviceFingerprint(
        mockReq({ headers: { "accept-language": "en-US" } })
      );
      const fp2 = generateDeviceFingerprint(
        mockReq({ headers: { "accept-language": "fr-FR" } })
      );
      expect(fp1).not.toBe(fp2);
    });

    it("is stable across accept-encoding changes (not a device signal)", () => {
      const fp1 = generateDeviceFingerprint(
        mockReq({ headers: { "accept-encoding": "gzip" } })
      );
      const fp2 = generateDeviceFingerprint(
        mockReq({ headers: { "accept-encoding": "br, zstd" } })
      );
      expect(fp1).toBe(fp2);
    });

    it("treats missing headers as empty strings", () => {
      const req = mockReq({ headers: {} });
      const fp = generateDeviceFingerprint(req);
      expect(fp).toMatch(/^[a-f0-9]{32}$/);
    });

    it("is stable across unknown/empty user-agents (Other collapse)", () => {
      // Unmatched UAs normalize to the same coarse fingerprint, so a session
      // bound by an unknown UA stays valid for other unknown UAs — they are
      // never treated as a DEVICE_MISMATCH against each other.
      const fp1 = generateDeviceFingerprint(mockReq({ headers: { "user-agent": "" } }));
      const fp2 = generateDeviceFingerprint(mockReq({ headers: { "user-agent": "SomeUnknownBrowser/9.9" } }));
      expect(fp1).toBe(fp2);
    });
  });

  describe("getClientIp", () => {
    it("extracts first IP from x-forwarded-for", () => {
      const req = mockReq({
        headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      });
      expect(getClientIp(req)).toBe("1.2.3.4");
    });

    it("trims whitespace around x-forwarded-for", () => {
      const req = mockReq({
        headers: { "x-forwarded-for": "  10.0.0.1 , 10.0.0.2" },
      });
      expect(getClientIp(req)).toBe("10.0.0.1");
    });

    it("falls back to socket.remoteAddress", () => {
      const req = mockReq({ remoteAddress: "192.168.1.1" });
      delete req.headers["x-forwarded-for"];
      expect(getClientIp(req)).toBe("192.168.1.1");
    });

    it("returns 'unknown' when no IP source is available", () => {
      const req = mockReq({});
      delete req.headers["x-forwarded-for"];
      (req.socket as { remoteAddress?: string }).remoteAddress = undefined;
      expect(getClientIp(req)).toBe("unknown");
    });

    it("normalizes IPv4-mapped IPv6 addresses", () => {
      const req = mockReq({ remoteAddress: "::ffff:127.0.0.1" });
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("returns single x-forwarded-for IP without splitting", () => {
      const req = mockReq({
        headers: { "x-forwarded-for": "8.8.8.8" },
      });
      expect(getClientIp(req)).toBe("8.8.8.8");
    });
  });

  describe("createSessionMetadata", () => {
    it("creates metadata with all required fields", () => {
      const req = mockReq();
      const meta = createSessionMetadata(req);

      // Binding is always deferred until the first browser request
      expect(meta.deviceId).toBeNull();
      expect(meta.ipAddress).toBe("127.0.0.1");
      expect(meta.userAgent).toBe("TestAgent/1.0");
      expect(meta.lastActivity).toBeTypeOf("number");
      expect(meta.lastActivity).toBeCloseTo(Date.now(), -2);
    });

    it("uses 'unknown' for missing user-agent", () => {
      const req = mockReq({ headers: { "user-agent": undefined } });
      const meta = createSessionMetadata(req);
      expect(meta.userAgent).toBe("unknown");
    });

    it("leaves binding pending (deviceId null) for server-to-server requests", () => {
      const req = mockReq({ headers: { "user-agent": "node" } });
      const meta = createSessionMetadata(req);
      expect(meta.deviceId).toBeNull();
      expect(meta.userAgent).toBe("node");
    });

    it("always defers binding (the exchange never carries browser headers)", () => {
      const req = mockReq();
      const meta = createSessionMetadata(req);
      expect(meta.deviceId).toBeNull();
    });

    it("extracts IP from x-forwarded-for", () => {
      const req = mockReq({
        headers: { "x-forwarded-for": "5.5.5.5" },
      });
      const meta = createSessionMetadata(req);
      expect(meta.ipAddress).toBe("5.5.5.5");
    });
  });

  describe("looksLikeServerToServerRequest", () => {
    it("returns true when no user-agent is present", () => {
      const req = mockReq({ headers: { "user-agent": undefined } });
      expect(looksLikeServerToServerRequest(req)).toBe(true);
    });

    it("returns true for Node runtime user-agents (undici fetch)", () => {
      expect(looksLikeServerToServerRequest(mockReq({ headers: { "user-agent": "node" } }))).toBe(true);
      expect(looksLikeServerToServerRequest(mockReq({ headers: { "user-agent": "undici" } }))).toBe(true);
      expect(looksLikeServerToServerRequest(mockReq({ headers: { "user-agent": "axios/1.7.0" } }))).toBe(true);
    });

    it("returns true for a browser UA without accept headers (conservative pending)", () => {
      const req = mockReq({
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/151.0.0.0",
          "accept-language": undefined,
          "accept-encoding": undefined,
        },
      });
      expect(looksLikeServerToServerRequest(req)).toBe(true);
    });

    it("returns false for a real browser request", () => {
      const req = mockReq({
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/151.0.0.0",
          "accept-language": "en-US,en;q=0.9",
          "accept-encoding": "gzip, deflate, br, zstd",
        },
      });
      expect(looksLikeServerToServerRequest(req)).toBe(false);
    });
  });

  describe("looksLikeServerToServerUA", () => {
    it("returns true for empty user-agents", () => {
      expect(looksLikeServerToServerUA("")).toBe(true);
    });

    it("returns true for server runtimes", () => {
      expect(looksLikeServerToServerUA("node")).toBe(true);
      expect(looksLikeServerToServerUA("undici")).toBe(true);
      expect(looksLikeServerToServerUA("curl/8.1.2")).toBe(true);
      expect(looksLikeServerToServerUA("node-superagent/4.1.1")).toBe(true);
    });

    it("returns false for browser user-agents", () => {
      expect(looksLikeServerToServerUA("Mozilla/5.0 (Windows NT 10.0) Chrome/151.0.0.0")).toBe(false);
    });
  });

  describe("isPrivateIp", () => {
    it("treats unknown / missing as private (unreliable)", () => {
      expect(isPrivateIp("unknown")).toBe(true);
      expect(isPrivateIp("")).toBe(true);
    });

    it("detects RFC1918 private ranges", () => {
      expect(isPrivateIp("10.26.192.4")).toBe(true);
      expect(isPrivateIp("10.0.0.1")).toBe(true);
      expect(isPrivateIp("172.16.0.1")).toBe(true);
      expect(isPrivateIp("172.31.255.255")).toBe(true);
      expect(isPrivateIp("192.168.1.100")).toBe(true);
    });

    it("detects link-local addresses", () => {
      expect(isPrivateIp("169.254.169.254")).toBe(true);
    });

    it("normalizes IPv4-mapped IPv6 private addresses", () => {
      expect(isPrivateIp("::ffff:10.26.192.4")).toBe(true);
    });

    it("detects IPv6 loopback / unique-local", () => {
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("fd00::1")).toBe(true);
      expect(isPrivateIp("fc00::1")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
    });

    it("returns false for public addresses", () => {
      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("203.0.113.7")).toBe(false);
      expect(isPrivateIp("1.1.1.1")).toBe(false);
    });

    it("does not treat loopback 127.0.0.1 as unreliable (local dev signal)", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(false);
    });
  });

  describe("validateSessionBinding", () => {
    it("returns valid for matching device and IP", () => {
      const req = mockReq();
      const meta = { ...createSessionMetadata(req), deviceId: generateDeviceFingerprint(req) };
      const result = validateSessionBinding(req, meta);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("returns invalid with DEVICE_MISMATCH on different browser family", () => {
      const req1 = mockReq({ headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" } });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };

      const req2 = mockReq({ headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0" } });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("DEVICE_MISMATCH");
    });

    it("returns invalid with DEVICE_MISMATCH on different language", () => {
      const req1 = mockReq({ headers: { "accept-language": "en" } });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };

      const req2 = mockReq({ headers: { "accept-language": "fr" } });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("DEVICE_MISMATCH");
    });

    it("returns invalid with SUSPICIOUS_IP_CHANGE when IP changed within 5 min", () => {
      const req1 = mockReq({ remoteAddress: "1.1.1.1" });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };
      meta.lastActivity = Date.now() - 60_000; // 1 minute ago

      const req2 = mockReq({ remoteAddress: "2.2.2.2" });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("SUSPICIOUS_IP_CHANGE");
    });

    it("allows IP change after 5 minutes", () => {
      const req1 = mockReq({ remoteAddress: "1.1.1.1" });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };
      meta.lastActivity = Date.now() - 600_000; // 10 minutes ago

      const req2 = mockReq({ remoteAddress: "2.2.2.2" });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(true);
    });

    it("does NOT flag SUSPICIOUS_IP_CHANGE when the current IP is private (proxy/internal hop)", () => {
      // Bound to the browser's real public IP, then a request arrives from a
      // private hosting IP (Render internal 10.x) — legitimate, not a hijack.
      const req1 = mockReq({ remoteAddress: "8.8.8.8" });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };
      meta.lastActivity = Date.now() - 60_000; // 1 minute ago

      const req2 = mockReq({ remoteAddress: "10.26.192.4" });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("does NOT flag SUSPICIOUS_IP_CHANGE when the stored IP is private (server-to-server exchange)", () => {
      const req1 = mockReq({ remoteAddress: "10.0.0.5" });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };
      meta.lastActivity = Date.now() - 60_000;

      const req2 = mockReq({ remoteAddress: "8.8.8.8" });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(true);
    });

    it("still flags SUSPICIOUS_IP_CHANGE between two public IPs within 5 min", () => {
      const req1 = mockReq({ remoteAddress: "8.8.8.8" });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };
      meta.lastActivity = Date.now() - 60_000;

      const req2 = mockReq({ remoteAddress: "8.8.4.4" });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("SUSPICIOUS_IP_CHANGE");
    });

    it("still rejects a device change even when one IP is private (device is the real signal)", () => {
      const req1 = mockReq({
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" },
        remoteAddress: "8.8.8.8",
      });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };

      const req2 = mockReq({
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0" },
        remoteAddress: "10.26.192.4",
      });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("DEVICE_MISMATCH");
    });

    it("returns DEVICE_MISMATCH before checking IP (device checked first)", () => {
      const req1 = mockReq({
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" },
        remoteAddress: "1.1.1.1",
      });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };

      const req2 = mockReq({
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0" },
        remoteAddress: "2.2.2.2",
      });
      const result = validateSessionBinding(req2, meta);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("DEVICE_MISMATCH");
    });

    it("allows IP change at exactly 5 minute boundary", () => {
      const req1 = mockReq({ remoteAddress: "1.1.1.1" });
      const meta = { ...createSessionMetadata(req1), deviceId: generateDeviceFingerprint(req1) };
      meta.lastActivity = Date.now() - 5 * 60 * 1000; // exactly 5 min ago

      const req2 = mockReq({ remoteAddress: "2.2.2.2" });
      const result = validateSessionBinding(req2, meta);

      // timeSinceLastActivity < maxIpChangeInterval → 300000 < 300000 → false
      expect(result.valid).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ACCOUNT LOCKOUT
// ═══════════════════════════════════════════════════════════════════════════════
describe("accountLockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue(mockRedis);
  });

  describe("recordFailedAttempt", () => {
    it("returns locked: true when already locked", async () => {
      const lockTs = Date.now() + 900_000;
      mockRedis.get.mockResolvedValueOnce(String(lockTs));

      const result = await recordFailedAttempt("user@test.com");

      expect(result.locked).toBe(true);
      expect(result.unlocksAt).toEqual(new Date(lockTs));
      expect(result.attempts).toBe(10);
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });

    it("increments failure count below threshold", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const mockExec = vi.fn().mockResolvedValue([[null, 5]]);
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: mockExec,
      } as any);

      const result = await recordFailedAttempt("user@test.com");

      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(5);
    });

    it("locks account when reaching max failures (10)", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const mockExec = vi.fn().mockResolvedValue([[null, 10]]);
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: mockExec,
      } as any);
      mockRedis.setex.mockResolvedValue("OK");

      const result = await recordFailedAttempt("user@test.com");

      expect(result.locked).toBe(true);
      expect(result.attempts).toBe(10);
      expect(result.unlocksAt).toBeInstanceOf(Date);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "focura:lockout:locked:user@test.com",
        900,
        expect.any(String)
      );
    });

    it("handles pipeline exec returning null", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      const result = await recordFailedAttempt("user@test.com");

      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(1); // defaults to 1
    });

    it("handles pipeline exec returning undefined values", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.pipeline.mockReturnValue({
        incr: vi.fn(),
        expire: vi.fn(),
        exec: vi.fn().mockResolvedValue([[undefined, undefined]]),
      } as any);

      const result = await recordFailedAttempt("user@test.com");

      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it("fails open on Redis error", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const result = await recordFailedAttempt("user@test.com");

      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(0);
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await recordFailedAttempt("user@test.com");

      expect(spy).toHaveBeenCalledWith(
        "[AccountLockout] Failed to record failed attempt:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("clearFailedAttempts", () => {
    it("deletes both failure and lock keys", async () => {
      mockRedis.del.mockResolvedValue(2);

      await clearFailedAttempts("user@test.com");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "focura:lockout:failures:user@test.com",
        "focura:lockout:locked:user@test.com"
      );
    });

    it("does not throw on Redis error", async () => {
      mockRedis.del.mockRejectedValueOnce(new Error("REDIS DOWN"));
      await expect(
        clearFailedAttempts("user@test.com")
      ).resolves.toBeUndefined();
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.del.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await clearFailedAttempts("user@test.com");

      expect(spy).toHaveBeenCalledWith(
        "[AccountLockout] Failed to clear failed attempts:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("isAccountLocked", () => {
    it("returns locked: false when no lock exists", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await isAccountLocked("user@test.com");

      expect(result.locked).toBe(false);
      expect(result.unlocksAt).toBeUndefined();
    });

    it("returns locked: true with date when lock exists", async () => {
      const lockTs = Date.now() + 900_000;
      mockRedis.get.mockResolvedValueOnce(String(lockTs));

      const result = await isAccountLocked("user@test.com");

      expect(result.locked).toBe(true);
      expect(result.unlocksAt).toEqual(new Date(lockTs));
    });

    it("fails open on Redis error", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const result = await isAccountLocked("user@test.com");

      expect(result.locked).toBe(false);
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await isAccountLocked("user@test.com");

      expect(spy).toHaveBeenCalledWith(
        "[AccountLockout] Failed to check account lock status:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REFRESH LOCK
// ═══════════════════════════════════════════════════════════════════════════════
describe("refreshLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue(mockRedis);
  });

  describe("acquireRefreshLock", () => {
    it("returns true when lock acquired (SET returns OK)", async () => {
      mockRedis.set.mockResolvedValueOnce("OK");

      const result = await acquireRefreshLock("session-123");

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "focura:refresh:lock:session-123",
        "1",
        "EX",
        45,
        "NX"
      );
    });

    it("returns false when lock not acquired (SET returns null)", async () => {
      mockRedis.set.mockResolvedValueOnce(null);

      const result = await acquireRefreshLock("session-123");

      expect(result).toBe(false);
    });

    it("returns true on Redis error (fail open)", async () => {
      mockRedis.set.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const result = await acquireRefreshLock("session-123");

      expect(result).toBe(true);
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.set.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await acquireRefreshLock("session-123");

      expect(spy).toHaveBeenCalledWith(
        "[RefreshLock] Failed to acquire lock:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("releaseRefreshLock", () => {
    it("deletes the lock key", async () => {
      mockRedis.del.mockResolvedValueOnce(1);

      await releaseRefreshLock("session-123");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "focura:refresh:lock:session-123"
      );
    });

    it("does not throw on Redis error", async () => {
      mockRedis.del.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        releaseRefreshLock("session-123")
      ).resolves.toBeUndefined();
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.del.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await releaseRefreshLock("session-123");

      expect(spy).toHaveBeenCalledWith(
        "[RefreshLock] Failed to release lock:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("isRefreshLocked", () => {
    it("returns true when lock value exists", async () => {
      mockRedis.get.mockResolvedValueOnce("1");

      const result = await isRefreshLocked("session-123");

      expect(result).toBe(true);
    });

    it("returns false when lock key does not exist", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await isRefreshLocked("session-123");

      expect(result).toBe(false);
    });

    it("returns false on Redis error (fail open)", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const result = await isRefreshLocked("session-123");

      expect(result).toBe(false);
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await isRefreshLocked("session-123");

      expect(spy).toHaveBeenCalledWith(
        "[RefreshLock] Failed to check lock status:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SESSION MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
describe("sessionManager", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue(mockRedis);
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("trackUserSession", () => {
    it("adds session to Redis set and sets TTL", async () => {
      mockRedis.smembers.mockResolvedValueOnce([]);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user1", "sess1");

      expect(mockRedis.sadd).toHaveBeenCalledWith(
        "user:sessions:user1",
        "sess1"
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        "user:sessions:user1",
        7 * 24 * 60 * 60
      );
    });

    it("evicts oldest session when at max capacity (5)", async () => {
      mockRedis.smembers.mockResolvedValueOnce([
        "sess-old-1",
        "sess-old-2",
        "sess-old-3",
        "sess-old-4",
        "sess-old-5",
      ]);
      mockRedis.srem.mockResolvedValueOnce(1);
      mockRedis.del.mockResolvedValueOnce(1);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user1", "sess-new");

      expect(mockRedis.srem).toHaveBeenCalledWith(
        "user:sessions:user1",
        "sess-old-1"
      );
      expect(mockRedis.del).toHaveBeenCalledWith(
        "session:metadata:sess-old-1"
      );
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        "user:sessions:user1",
        "sess-new"
      );
    });

    it("logs MAX_SESSIONS_REACHED audit event when at limit", async () => {
      mockRedis.smembers.mockResolvedValueOnce([
        "s1",
        "s2",
        "s3",
        "s4",
        "s5",
      ]);
      mockRedis.srem.mockResolvedValueOnce(1);
      mockRedis.del.mockResolvedValueOnce(1);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user1", "s6");

      // MAX_SESSIONS_REACHED has severity "warn" → logged via console.warn
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("MAX_SESSIONS_REACHED")
      );
    });

    it("does not evict when under max capacity", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["s1", "s2"]);
      mockRedis.sadd.mockResolvedValueOnce(1);
      mockRedis.expire.mockResolvedValueOnce(1);

      await trackUserSession("user1", "s3");

      expect(mockRedis.srem).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it("handles Redis error gracefully", async () => {
      mockRedis.smembers.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await trackUserSession("user1", "s1");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SessionManager] Failed to track session for user user1:"
        ),
        expect.any(Error)
      );
    });
  });

  describe("revokeUserSession", () => {
    it("removes session from set and deletes metadata", async () => {
      mockRedis.srem.mockResolvedValueOnce(1);
      mockRedis.del.mockResolvedValueOnce(1);

      await revokeUserSession("user1", "sess1");

      expect(mockRedis.srem).toHaveBeenCalledWith(
        "user:sessions:user1",
        "sess1"
      );
      expect(mockRedis.del).toHaveBeenCalledWith("session:metadata:sess1");
    });

    it("handles Redis error gracefully", async () => {
      mockRedis.srem.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await revokeUserSession("user1", "sess1");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SessionManager] Failed to revoke session for user user1:"
        ),
        expect.any(Error)
      );
    });
  });

  describe("getUserActiveSessions", () => {
    it("returns sessions with parsed metadata", async () => {
      const now = Date.now();
      mockRedis.smembers.mockResolvedValueOnce(["sess1", "sess2"]);
      mockRedis.get
        .mockResolvedValueOnce(
          JSON.stringify({ userAgent: "Chrome/1.0", lastActivity: now })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            userAgent: "Firefox/1.0",
            lastActivity: now - 1000,
          })
        );

      const sessions = await getUserActiveSessions("user1");

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe("sess1");
      expect(sessions[0].deviceInfo).toBe("Chrome/1.0");
      expect(sessions[0].lastActivity).toBe(new Date(now).toISOString());
      expect(sessions[1].sessionId).toBe("sess2");
      expect(sessions[1].deviceInfo).toBe("Firefox/1.0");
    });

    it("skips sessions with no metadata", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["sess1", "sess2"]);
      mockRedis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          JSON.stringify({
            userAgent: "Safari/1.0",
            lastActivity: Date.now(),
          })
        );

      const sessions = await getUserActiveSessions("user1");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("sess2");
    });

    it("skips sessions with corrupted metadata", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["sess1", "sess2"]);
      mockRedis.get
        .mockResolvedValueOnce("NOT-JSON")
        .mockResolvedValueOnce(
          JSON.stringify({
            userAgent: "Edge/1.0",
            lastActivity: Date.now(),
          })
        );

      const sessions = await getUserActiveSessions("user1");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("sess2");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Corrupted session metadata for session sess1"
        )
      );
    });

    it("returns empty array when no sessions exist", async () => {
      mockRedis.smembers.mockResolvedValueOnce([]);

      const sessions = await getUserActiveSessions("user1");

      expect(sessions).toEqual([]);
    });

    it("returns empty array on Redis error", async () => {
      mockRedis.smembers.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const sessions = await getUserActiveSessions("user1");

      expect(sessions).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SessionManager] Failed to get sessions for user user1:"
        ),
        expect.any(Error)
      );
    });

    it("returns empty array when all metadata is corrupted", async () => {
      mockRedis.smembers.mockResolvedValueOnce(["s1", "s2"]);
      mockRedis.get.mockResolvedValue("NOT-JSON");

      const sessions = await getUserActiveSessions("user1");

      expect(sessions).toEqual([]);
      // warnSpy called twice (once per corrupted session)
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TOKEN REVOCATION
// ═══════════════════════════════════════════════════════════════════════════════
describe("tokenRevocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue(mockRedis);
  });

  describe("revokeAccessToken", () => {
    it("stores revoked token with TTL", async () => {
      mockRedis.setex.mockResolvedValueOnce("OK");

      await revokeAccessToken("jti-abc", 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "focura:revoked:access:jti-abc",
        3600,
        "1"
      );
    });

    it("does not throw on Redis error", async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        revokeAccessToken("jti-abc", 3600)
      ).resolves.toBeUndefined();
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.setex.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await revokeAccessToken("jti-abc", 3600);

      expect(spy).toHaveBeenCalledWith(
        "[TokenRevocation] Failed to revoke access token:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("isAccessTokenRevoked", () => {
    it("returns true when token is revoked", async () => {
      mockRedis.get.mockResolvedValueOnce("1");

      const result = await isAccessTokenRevoked("jti-abc");

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(
        "focura:revoked:access:jti-abc"
      );
    });

    it("returns false when token is not revoked", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await isAccessTokenRevoked("jti-abc");

      expect(result).toBe(false);
    });

    it("returns false when Redis returns different value", async () => {
      mockRedis.get.mockResolvedValueOnce("something-else");

      const result = await isAccessTokenRevoked("jti-abc");

      expect(result).toBe(false);
    });

    it("fails open on Redis error", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const result = await isAccessTokenRevoked("jti-abc");

      expect(result).toBe(false);
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await isAccessTokenRevoked("jti-abc");

      expect(spy).toHaveBeenCalledWith(
        "[TokenRevocation] Failed to check revoked access token:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("storeRefreshToken", () => {
    it("stores token with TTL and adds to index set", async () => {
      mockRedis.setex.mockResolvedValueOnce("OK");
      mockRedis.sadd.mockResolvedValueOnce(1);

      await storeRefreshToken("user1", "jti-abc", 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "focura:refresh:user1:jti-abc",
        3600,
        expect.stringContaining('"jti":"jti-abc"')
      );
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        "focura:refresh:index:user1",
        "focura:refresh:user1:jti-abc"
      );
    });

    it("does not throw on Redis error", async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        storeRefreshToken("user1", "jti-abc", 3600)
      ).resolves.toBeUndefined();
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.setex.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await storeRefreshToken("user1", "jti-abc", 3600);

      expect(spy).toHaveBeenCalledWith(
        "[TokenRevocation] Failed to store refresh token:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("isRefreshTokenValid", () => {
    it("returns true when token exists", async () => {
      mockRedis.get.mockResolvedValueOnce('{"jti":"jti-abc"}');

      const result = await isRefreshTokenValid("user1", "jti-abc");

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(
        "focura:refresh:user1:jti-abc"
      );
    });

    it("returns false when token does not exist", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await isRefreshTokenValid("user1", "jti-abc");

      expect(result).toBe(false);
    });

    it("returns false on Redis error", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      const result = await isRefreshTokenValid("user1", "jti-abc");

      expect(result).toBe(false);
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.get.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await isRefreshTokenValid("user1", "jti-abc");

      expect(spy).toHaveBeenCalledWith(
        "[TokenRevocation] Failed to check refresh token validity:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("revokeRefreshToken", () => {
    it("deletes token key and removes from index set", async () => {
      mockRedis.del.mockResolvedValueOnce(1);
      mockRedis.srem.mockResolvedValueOnce(1);

      await revokeRefreshToken("user1", "jti-abc");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "focura:refresh:user1:jti-abc"
      );
      expect(mockRedis.srem).toHaveBeenCalledWith(
        "focura:refresh:index:user1",
        "focura:refresh:user1:jti-abc"
      );
    });

    it("does not throw on Redis error", async () => {
      mockRedis.del.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        revokeRefreshToken("user1", "jti-abc")
      ).resolves.toBeUndefined();
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.del.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await revokeRefreshToken("user1", "jti-abc");

      expect(spy).toHaveBeenCalledWith(
        "[TokenRevocation] Failed to revoke refresh token:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("revokeAllRefreshTokens", () => {
    it("revokes all tokens via index when index has keys", async () => {
      mockRedis.smembers.mockResolvedValueOnce([
        "focura:refresh:user1:j1",
        "focura:refresh:user1:j2",
      ]);
      mockRedis.del.mockResolvedValueOnce(2);
      mockRedis.del.mockResolvedValueOnce(1);

      await revokeAllRefreshTokens("user1");

      expect(mockRedis.del).toHaveBeenCalledWith(
        "focura:refresh:user1:j1",
        "focura:refresh:user1:j2"
      );
      expect(mockRedis.del).toHaveBeenCalledWith(
        "focura:refresh:index:user1"
      );
      expect(mockRedis.keys).not.toHaveBeenCalled();
    });

    it("falls back to SCAN when index is empty", async () => {
      mockRedis.smembers.mockResolvedValueOnce([]);
      mockRedis.scan
        .mockResolvedValueOnce(['0', ["focura:refresh:user1:k1", "focura:refresh:user1:k2"]]);
      mockRedis.del.mockResolvedValueOnce(2);
      mockRedis.del.mockResolvedValueOnce(1);

      await revokeAllRefreshTokens("user1");

      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'focura:refresh:user1:*', 'COUNT', 100);
      expect(mockRedis.del).toHaveBeenCalledWith(
        "focura:refresh:user1:k1",
        "focura:refresh:user1:k2"
      );
    });

    it("does not call del on token keys when both index and SCAN return empty", async () => {
      mockRedis.smembers.mockResolvedValueOnce([]);
      mockRedis.scan.mockResolvedValueOnce(['0', []]);
      mockRedis.del.mockResolvedValueOnce(1);

      await revokeAllRefreshTokens("user1");

      // only the index key delete
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith("focura:refresh:index:user1");
    });

    it("does not throw on Redis error", async () => {
      mockRedis.smembers.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        revokeAllRefreshTokens("user1")
      ).resolves.toBeUndefined();
    });

    it("logs error on Redis failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedis.smembers.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await revokeAllRefreshTokens("user1");

      expect(spy).toHaveBeenCalledWith(
        "[TokenRevocation] Failed to revoke all refresh tokens:",
        expect.any(Error)
      );
      spy.mockRestore();
    });
  });

  describe("rotateRefreshToken", () => {
    it("returns true when rotation succeeds (old token existed)", async () => {
      mockRedis.eval.mockResolvedValueOnce(1);

      const result = await rotateRefreshToken(
        "user1",
        "oldJti",
        "newJti",
        3600
      );

      expect(result).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call"),
        3,
        "focura:refresh:user1:oldJti",
        "focura:refresh:user1:newJti",
        "focura:refresh:index:user1",
        "3600",
        expect.stringContaining('"jti":"newJti"')
      );
    });

    it("returns false when old token did not exist", async () => {
      mockRedis.eval.mockResolvedValueOnce(0);

      const result = await rotateRefreshToken(
        "user1",
        "oldJti",
        "newJti",
        3600
      );

      expect(result).toBe(false);
    });

    it("throws on Redis error so the refresh endpoint can fail-open", async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        rotateRefreshToken("user1", "oldJti", "newJti", 3600)
      ).rejects.toThrow("REDIS DOWN");
    });

    it("passes correct Lua script arguments", async () => {
      mockRedis.eval.mockResolvedValueOnce(1);

      await rotateRefreshToken("u42", "old123", "new456", 7200);

      const args = mockRedis.eval.mock.calls[0];
      expect(args[1]).toBe(3); // 3 KEYS
      expect(args[2]).toBe("focura:refresh:u42:old123");
      expect(args[3]).toBe("focura:refresh:u42:new456");
      expect(args[4]).toBe("focura:refresh:index:u42");
      expect(args[5]).toBe("7200");
      const payload = JSON.parse(args[6]);
      expect(payload.jti).toBe("new456");
      expect(payload.createdAt).toBeTypeOf("number");
    });
  });

  describe("storeSseToken", () => {
    it("stores SSE token with 30s TTL", async () => {
      mockRedis.setex.mockResolvedValueOnce("OK");

      await storeSseToken("jti-sse", "user1");

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "focura:sse:jti-sse",
        30,
        "user1"
      );
    });

    it("throws on Redis error so callers know the token was never stored", async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(
        storeSseToken("jti-sse", "user1")
      ).rejects.toThrow("REDIS DOWN");
    });
  });

  describe("consumeSseToken", () => {
    it("returns userId via atomic Lua get-and-delete when the token exists", async () => {
      mockRedis.eval.mockResolvedValueOnce("user1");

      const result = await consumeSseToken("jti-sse");

      expect(result).toBe("user1");
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call"),
        1,
        "focura:sse:jti-sse",
      );
    });

    it("returns null when token does not exist", async () => {
      mockRedis.eval.mockResolvedValueOnce(null);

      const result = await consumeSseToken("jti-sse");

      expect(result).toBeNull();
    });

    it("throws on Redis error so the caller can distinguish it from not-found", async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error("REDIS DOWN"));

      await expect(consumeSseToken("jti-sse")).rejects.toThrow("REDIS DOWN");
    });

    it("consumes in a single atomic Lua round-trip (no get-then-del race)", async () => {
      mockRedis.eval.mockResolvedValueOnce("user1");

      await consumeSseToken("jti-sse");

      // One eval only — the GET+DEL happen inside the script, so two
      // concurrent replays can never both observe the key before deletion.
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
