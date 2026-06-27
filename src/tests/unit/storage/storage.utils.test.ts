import { describe, it, expect } from "vitest";
import { toMB, getMaxFileSizeForPlan, getCategoryFromMimeType } from "../../../modules/storage/storage.utils.js";

describe("StorageUtils", () => {
  describe("toMB", () => {
    it("should convert bytes to MB correctly", () => {
      expect(toMB(1024 * 1024)).toBe(1);
      expect(toMB(0)).toBe(0);
      expect(toMB(524288)).toBe(0.5);
      expect(toMB(1572864)).toBe(1.5);
    });

    it("should round to 2 decimal places", () => {
      expect(toMB(1100000)).toBe(1.05);
    });
  });

  describe("getMaxFileSizeForPlan", () => {
    it("should return correct limits for known plans", () => {
      expect(getMaxFileSizeForPlan("FREE")).toBe(5);
      expect(getMaxFileSizeForPlan("PRO")).toBe(25);
      expect(getMaxFileSizeForPlan("BUSINESS")).toBe(100);
      expect(getMaxFileSizeForPlan("ENTERPRISE")).toBe(500);
    });

    it("should return default limit for unknown plan", () => {
      expect(getMaxFileSizeForPlan("UNKNOWN")).toBe(5);
    });
  });

  describe("getCategoryFromMimeType", () => {
    it("should categorize images correctly", () => {
      expect(getCategoryFromMimeType("image/jpeg")).toBe("Images");
      expect(getCategoryFromMimeType("image/png")).toBe("Images");
      expect(getCategoryFromMimeType("image/gif")).toBe("Images");
    });

    it("should categorize videos correctly", () => {
      expect(getCategoryFromMimeType("video/mp4")).toBe("Videos");
      expect(getCategoryFromMimeType("video/quicktime")).toBe("Videos");
    });

    it("should categorize PDFs correctly", () => {
      expect(getCategoryFromMimeType("application/pdf")).toBe("PDFs");
    });

    it("should categorize documents correctly", () => {
      expect(getCategoryFromMimeType("application/msword")).toBe("Documents");
      expect(getCategoryFromMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("Documents");
    });

    it("should categorize spreadsheets correctly", () => {
      expect(getCategoryFromMimeType("application/vnd.ms-excel")).toBe("Spreadsheets");
      expect(getCategoryFromMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("Spreadsheets");
    });

    it("should categorize presentations correctly", () => {
      expect(getCategoryFromMimeType("application/vnd.ms-powerpoint")).toBe("Presentations");
      expect(getCategoryFromMimeType("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("Presentations");
    });

    it("should categorize archives correctly", () => {
      expect(getCategoryFromMimeType("application/zip")).toBe("Archives");
      expect(getCategoryFromMimeType("application/x-rar-compressed")).toBe("Archives");
    });

    it("should return 'Other' for unknown mime types", () => {
      expect(getCategoryFromMimeType("text/plain")).toBe("Other");
      expect(getCategoryFromMimeType("application/json")).toBe("Other");
    });
  });
});
