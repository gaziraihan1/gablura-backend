/**
 * src/tests/unit/apikey/apikey.utils.test.ts
 *
 * Unit tests for API key utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  generateApiToken,
  hashToken,
  verifyToken,
  isValidTokenFormat,
  extractPrefix,
} from "../../../modules/apikey/apikey.utils.js";

describe("ApiKey Utils", () => {
  describe("generateApiToken", () => {
    it("should generate a token with foc_ prefix", () => {
      const { rawToken, prefix } = generateApiToken();

      expect(rawToken).toMatch(/^foc_/);
      expect(prefix).toMatch(/^foc_/);
    });

    it("should generate unique tokens", () => {
      const token1 = generateApiToken();
      const token2 = generateApiToken();

      expect(token1.rawToken).not.toBe(token2.rawToken);
    });

    it("should have correct prefix length", () => {
      const { prefix } = generateApiToken();

      expect(prefix.length).toBe(12); // "foc_" + 8 chars
    });
  });

  describe("hashToken and verifyToken", () => {
    it("should hash and verify a token", async () => {
      const token = "foc_testtoken123";
      const hash = await hashToken(token);

      expect(hash).not.toBe(token);
      expect(await verifyToken(token, hash)).toBe(true);
    });

    it("should reject invalid token", async () => {
      const token = "foc_testtoken123";
      const hash = await hashToken(token);

      expect(await verifyToken("wrong_token", hash)).toBe(false);
    });
  });

  describe("isValidTokenFormat", () => {
    it("should return true for valid format", () => {
      expect(isValidTokenFormat("foc_abc123def456")).toBe(true);
    });

    it("should return false for invalid format", () => {
      expect(isValidTokenFormat("invalid_token")).toBe(false);
      expect(isValidTokenFormat("foc_")).toBe(false);
    });
  });

  describe("extractPrefix", () => {
    it("should extract first 12 characters", () => {
      const token = "foc_abc123def456xyz";
      const prefix = extractPrefix(token);

      expect(prefix).toBe("foc_abc123de");
      expect(prefix.length).toBe(12);
    });
  });
});
