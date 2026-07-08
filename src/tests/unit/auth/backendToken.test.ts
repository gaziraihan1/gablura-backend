import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Generate test keys once before module import
const { privateKey: testPrivateKey, publicKey: testPublicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Set environment variables before importing the module
process.env.JWT_PRIVATE_KEY = Buffer.from(testPrivateKey).toString("base64");
process.env.JWT_PUBLIC_KEY = Buffer.from(testPublicKey).toString("base64");

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

import {
  createAccessToken,
  createRefreshToken,
  createTokenPair,
  createSseToken,
  verifyToken,
  parseExpiry,
  extractJti,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  SSE_TOKEN_EXPIRY,
  CURRENT_TOKEN_VERSION,
} from "../../../lib/auth/backendToken.js";

describe("backendToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAccessToken", () => {
    it("creates a valid access token with correct payload", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.sub).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.type).toBe("access");
      expect(decoded.version).toBe(CURRENT_TOKEN_VERSION);
      expect(decoded.jti).toBeDefined();
      expect(decoded.sessionId).toBe(payload.sessionId);
    });

    it("creates token with RS256 algorithm", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);
      const decoded = jwt.decode(token, { complete: true }) as any;

      expect(decoded.header.alg).toBe("RS256");
    });

    it("includes correct issuer and audience", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);
      const decoded = jwt.decode(token, { complete: true }) as any;

      expect(decoded.payload.iss).toBe("focura-app");
      expect(decoded.payload.aud).toBe("focura-backend");
    });
  });

  describe("createRefreshToken", () => {
    it("creates a valid refresh token with correct payload", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createRefreshToken(payload);
      const decoded = jwt.decode(token) as any;

      expect(decoded.sub).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.type).toBe("refresh");
      expect(decoded.version).toBe(CURRENT_TOKEN_VERSION);
      expect(decoded.jti).toBeDefined();
      expect(decoded.sessionId).toBe(payload.sessionId);
    });
  });

  describe("createTokenPair", () => {
    it("creates both access and refresh tokens", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const pair = createTokenPair(payload);

      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();
      expect(pair.accessTokenExpiry).toBeGreaterThan(Date.now());
      expect(pair.refreshTokenExpiry).toBeGreaterThan(pair.accessTokenExpiry);
    });

    it("generates sessionId if not provided", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
      };

      const pair = createTokenPair(payload);

      const accessDecoded = jwt.decode(pair.accessToken) as any;
      const refreshDecoded = jwt.decode(pair.refreshToken) as any;

      expect(accessDecoded.sessionId).toBe(refreshDecoded.sessionId);
      expect(accessDecoded.sessionId).toBeDefined();
    });

    it("uses provided sessionId if given", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "custom-session",
      };

      const pair = createTokenPair(payload);

      const accessDecoded = jwt.decode(pair.accessToken) as any;
      const refreshDecoded = jwt.decode(pair.refreshToken) as any;

      expect(accessDecoded.sessionId).toBe("custom-session");
      expect(refreshDecoded.sessionId).toBe("custom-session");
    });
  });

  describe("createSseToken", () => {
    it("creates a valid SSE token with correct payload", () => {
      const userId = "user-123";
      const token = createSseToken(userId);
      const decoded = jwt.decode(token) as any;

      expect(decoded.sub).toBe(userId);
      expect(decoded.type).toBe("sse");
      expect(decoded.version).toBe(CURRENT_TOKEN_VERSION);
      expect(decoded.jti).toBeDefined();
    });

    it("does not include email or role in SSE token", () => {
      const userId = "user-123";
      const token = createSseToken(userId);
      const decoded = jwt.decode(token) as any;

      expect(decoded.email).toBeUndefined();
      expect(decoded.role).toBeUndefined();
    });
  });

  describe("verifyToken", () => {
    it("verifies a valid access token and returns payload", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);
      const verified = verifyToken(token, "access");

      expect(verified.id).toBe(payload.id);
      expect(verified.email).toBe(payload.email);
      expect(verified.role).toBe(payload.role);
      expect(verified.type).toBe("access");
      expect(verified.sessionId).toBe(payload.sessionId);
    });

    it("throws error for invalid token", () => {
      expect(() => verifyToken("invalid.token.here")).toThrow();
    });

    it("throws error for token version mismatch", () => {
      // Mock jwt.verify to return a payload with a wrong version
      vi.spyOn(jwt, 'verify').mockReturnValueOnce({
        sub: "user-123",
        email: "test@example.com",
        role: "USER",
        type: "access",
        version: 99, // Wrong version
        jti: "test-jti",
        sessionId: "session-abc",
      } as any);

      expect(() => verifyToken("some-token", "access")).toThrow("Token version mismatch");
      vi.restoreAllMocks();
    });

    it("throws error when token type does not match expected type", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);

      expect(() => verifyToken(token, "refresh")).toThrow("Expected 'refresh', got 'access'");
    });

    it("verifies token without type check when expectedType not provided", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);
      const verified = verifyToken(token);

      expect(verified.type).toBe("access");
    });
  });

  describe("parseExpiry", () => {
    it("parses seconds correctly", () => {
      expect(parseExpiry("30s")).toBe(30000);
    });

    it("parses minutes correctly", () => {
      expect(parseExpiry("15m")).toBe(900000);
    });

    it("parses hours correctly", () => {
      expect(parseExpiry("2h")).toBe(7200000);
    });

    it("parses days correctly", () => {
      expect(parseExpiry("7d")).toBe(604800000);
    });

    it("throws error for invalid format", () => {
      expect(() => parseExpiry("invalid")).toThrow("Invalid expiry");
    });

    it("throws error for invalid unit", () => {
      expect(() => parseExpiry("30x")).toThrow("Invalid expiry");
    });
  });

  describe("extractJti", () => {
    it("extracts JTI from valid token", () => {
      const payload = {
        id: "user-123",
        email: "test@example.com",
        role: "USER",
        sessionId: "session-abc",
      };

      const token = createAccessToken(payload);
      const jti = extractJti(token);

      expect(jti).toBeDefined();
      expect(typeof jti).toBe("string");
    });

    it("returns empty string for token without JTI", () => {
      const token = jwt.sign(
        { sub: "user-123", email: "test@example.com" },
        testPrivateKey,
        { algorithm: "RS256" },
      );

      const jti = extractJti(token);
      expect(jti).toBe("");
    });

    it("handles malformed token gracefully", () => {
      const jti = extractJti("invalid.token");
      expect(jti).toBe("");
    });
  });

  describe("token constants", () => {
    it("has correct expiry constants", () => {
      expect(ACCESS_TOKEN_EXPIRY).toBe("15m");
      expect(REFRESH_TOKEN_EXPIRY).toBe("7d");
      expect(SSE_TOKEN_EXPIRY).toBe("30s");
    });

    it("has current token version", () => {
      expect(CURRENT_TOKEN_VERSION).toBe(1);
    });
  });
});