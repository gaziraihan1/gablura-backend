import { describe, it, expect } from "vitest";
import {
  largestFilesQuerySchema,
  bulkDeleteSchema,
  checkUploadSchema,
} from "../../../modules/storage/storage.validators.js";

describe("Storage Validation", () => {
  describe("largestFilesQuerySchema", () => {
    it("should validate valid query", () => {
      const data = { limit: "10" };
      const result = largestFilesQuerySchema.parse(data);
      expect(result).toEqual({ limit: 10 });
    });

    it("should default limit to 10", () => {
      const result = largestFilesQuerySchema.parse({});
      expect(result.limit).toBe(10);
    });

    it("should coerce limit to number", () => {
      const result = largestFilesQuerySchema.parse({ limit: "20" });
      expect(result.limit).toBe(20);
    });

    it("should accept minimum limit of 1", () => {
      const result = largestFilesQuerySchema.parse({ limit: "1" });
      expect(result.limit).toBe(1);
    });

    it("should accept maximum limit of 100", () => {
      const result = largestFilesQuerySchema.parse({ limit: "100" });
      expect(result.limit).toBe(100);
    });

    it("should reject limit less than 1", () => {
      expect(() => largestFilesQuerySchema.parse({ limit: "0" })).toThrow();
    });

    it("should reject limit greater than 100", () => {
      expect(() => largestFilesQuerySchema.parse({ limit: "101" })).toThrow();
    });

    it("should reject negative limit", () => {
      expect(() => largestFilesQuerySchema.parse({ limit: "-5" })).toThrow();
    });

    it("should reject non-numeric limit", () => {
      expect(() => largestFilesQuerySchema.parse({ limit: "abc" })).toThrow();
    });
  });

  describe("bulkDeleteSchema", () => {
    it("should validate valid data", () => {
      const data = { fileIds: ["file1", "file2", "file3"] };
      const result = bulkDeleteSchema.parse(data);
      expect(result).toEqual(data);
    });

    it("should accept single file ID", () => {
      const data = { fileIds: ["file1"] };
      const result = bulkDeleteSchema.parse(data);
      expect(result).toEqual(data);
    });

    it("should require fileIds", () => {
      const data = {};
      expect(() => bulkDeleteSchema.parse(data)).toThrow();
    });

    it("should require at least one file ID", () => {
      const data = { fileIds: [] };
      expect(() => bulkDeleteSchema.parse(data)).toThrow();
    });

    it("should reject non-array fileIds", () => {
      const data = { fileIds: "file1" };
      expect(() => bulkDeleteSchema.parse(data)).toThrow();
    });

    it("should reject non-string file IDs", () => {
      const data = { fileIds: [123, 456] };
      expect(() => bulkDeleteSchema.parse(data)).toThrow();
    });
  });

  describe("checkUploadSchema", () => {
    it("should validate valid data", () => {
      const data = { fileSize: 1024 * 1024 };
      const result = checkUploadSchema.parse(data);
      expect(result).toEqual(data);
    });

    it("should accept small file sizes", () => {
      const data = { fileSize: 1024 };
      const result = checkUploadSchema.parse(data);
      expect(result).toEqual(data);
    });

    it("should accept large file sizes", () => {
      const data = { fileSize: 100 * 1024 * 1024 };
      const result = checkUploadSchema.parse(data);
      expect(result).toEqual(data);
    });

    it("should require fileSize", () => {
      const data = {};
      expect(() => checkUploadSchema.parse(data)).toThrow();
    });

    it("should reject negative file sizes", () => {
      const data = { fileSize: -1024 };
      expect(() => checkUploadSchema.parse(data)).toThrow();
    });

    it("should reject zero file size", () => {
      const data = { fileSize: 0 };
      expect(() => checkUploadSchema.parse(data)).toThrow();
    });

    it("should reject non-numeric file sizes", () => {
      const data = { fileSize: "1024" };
      expect(() => checkUploadSchema.parse(data)).toThrow();
    });
  });
});
