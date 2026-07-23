/**
 * src/tests/unit/apikey/apikey.controller.test.ts
 *
 * Unit tests for API key controller.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Response } from "express";
import type { AuthRequest } from "../../../middleware/auth.js";

// Mock the model
vi.mock("../../../modules/apikey/apikey.model.js", () => ({
  createApiKey: vi.fn(),
  getApiKeysByUser: vi.fn(),
  getApiKeyById: vi.fn(),
  toggleApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));

import * as ApiKeyModel from "../../../modules/apikey/apikey.model.js";
import * as ApiKeyController from "../../../modules/apikey/apikey.controller.js";
import { BadRequestError, NotFoundError } from "../../../errors/index.js";

describe("ApiKey Controller", () => {
  const mockUserId = "user-123";
  const mockReq = { user: { id: mockUserId }, body: {}, params: {} } as unknown as AuthRequest;
  const mockRes = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getApiKeys", () => {
    it("should return all API keys for user", async () => {
      const mockKeys = [{ id: "key-1", name: "Test Key" }];
      (ApiKeyModel.getApiKeysByUser as any).mockResolvedValue(mockKeys);

      await ApiKeyController.getApiKeys(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockKeys,
      });
    });
  });

  describe("createApiKey", () => {
    it("should create a new API key", async () => {
      const mockKey = {
        id: "key-123",
        name: "New Key",
        prefix: "foc_abc12345",
      };
      (ApiKeyModel.createApiKey as any).mockResolvedValue({
        apiKey: mockKey,
        rawToken: "foc_abc12345xyz",
      });
      (ApiKeyModel.getApiKeysByUser as any).mockResolvedValue([]);

      const req = {
        user: { id: mockUserId },
        body: { name: "New Key" },
      } as unknown as AuthRequest;

      await ApiKeyController.createApiKey(req, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            token: "foc_abc12345xyz",
          }),
        })
      );
    });

    it("should throw error if name is missing", async () => {
      const req = {
        user: { id: mockUserId },
        body: {},
      } as unknown as AuthRequest;

      await expect(ApiKeyController.createApiKey(req, mockRes)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe("toggleApiKey", () => {
    it("should toggle API key status", async () => {
      const mockKey = { id: "key-123", isActive: false };
      (ApiKeyModel.toggleApiKey as any).mockResolvedValue(mockKey);

      const req = {
        user: { id: mockUserId },
        params: { id: "key-123" },
      } as unknown as AuthRequest;

      await ApiKeyController.toggleApiKey(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockKey,
        })
      );
    });

    it("should throw NotFoundError if key not found", async () => {
      (ApiKeyModel.toggleApiKey as any).mockResolvedValue(null);

      const req = {
        user: { id: mockUserId },
        params: { id: "nonexistent" },
      } as unknown as AuthRequest;

      await expect(ApiKeyController.toggleApiKey(req, mockRes)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("deleteApiKey", () => {
    it("should delete an API key", async () => {
      (ApiKeyModel.deleteApiKey as any).mockResolvedValue(true);

      const req = {
        user: { id: mockUserId },
        params: { id: "key-123" },
      } as unknown as AuthRequest;

      await ApiKeyController.deleteApiKey(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("deleted"),
        })
      );
    });

    it("should throw NotFoundError if key not found", async () => {
      (ApiKeyModel.deleteApiKey as any).mockResolvedValue(false);

      const req = {
        user: { id: mockUserId },
        params: { id: "nonexistent" },
      } as unknown as AuthRequest;

      await expect(ApiKeyController.deleteApiKey(req, mockRes)).rejects.toThrow(
        NotFoundError
      );
    });
  });
});
