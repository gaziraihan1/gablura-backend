/**
 * src/tests/unit/apikey/apikey.model.test.ts
 *
 * Unit tests for API key model operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock Prisma
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../../lib/prisma.js";
import {
  createApiKey,
  getApiKeysByUser,
  getApiKeyById,
  toggleApiKey,
  deleteApiKey,
} from "../../../modules/apikey/apikey.model.js";

describe("ApiKey Model", () => {
  const mockUserId = "user-123";
  const mockApiKey = {
    id: "key-123",
    name: "Test API Key",
    prefix: "foc_a1b2c3d4",
    lastUsedAt: null,
    expiresAt: null,
    isActive: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createApiKey", () => {
    it("should create a new API key", async () => {
      (prisma.apiKey.create as any).mockResolvedValue(mockApiKey);

      const result = await createApiKey(mockUserId, "Test API Key");

      expect(result.apiKey).toEqual(mockApiKey);
      expect(result.rawToken).toMatch(/^foc_/);
      expect(prisma.apiKey.create).toHaveBeenCalled();
    });

    it("should create API key with expiration", async () => {
      (prisma.apiKey.create as any).mockResolvedValue({
        ...mockApiKey,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const result = await createApiKey(mockUserId, "Expiring Key", 30);

      expect(result.apiKey.expiresAt).toBeTruthy();
    });
  });

  describe("getApiKeysByUser", () => {
    it("should return all API keys for a user", async () => {
      (prisma.apiKey.findMany as any).mockResolvedValue([mockApiKey]);

      const result = await getApiKeysByUser(mockUserId);

      expect(result).toEqual([mockApiKey]);
      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        select: expect.any(Object),
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("getApiKeyById", () => {
    it("should return an API key by ID", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue(mockApiKey);

      const result = await getApiKeyById("key-123", mockUserId);

      expect(result).toEqual(mockApiKey);
    });

    it("should return null if not found", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue(null);

      const result = await getApiKeyById("nonexistent", mockUserId);

      expect(result).toBeNull();
    });
  });

  describe("toggleApiKey", () => {
    it("should toggle API key active status", async () => {
      (prisma.apiKey.findFirst as any).mockResolvedValue({
        id: "key-123",
        isActive: true,
      });
      (prisma.apiKey.update as any).mockResolvedValue({
        ...mockApiKey,
        isActive: false,
      });

      const result = await toggleApiKey("key-123", mockUserId);

      expect(result?.isActive).toBe(false);
    });
  });

  describe("deleteApiKey", () => {
    it("should delete an API key", async () => {
      (prisma.apiKey.deleteMany as any).mockResolvedValue({ count: 1 });

      const result = await deleteApiKey("key-123", mockUserId);

      expect(result).toBe(true);
    });

    it("should return false if not found", async () => {
      (prisma.apiKey.deleteMany as any).mockResolvedValue({ count: 0 });

      const result = await deleteApiKey("nonexistent", mockUserId);

      expect(result).toBe(false);
    });
  });
});
