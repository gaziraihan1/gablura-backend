import { describe, it, expect } from "vitest";

import {
  sanitizePlainText,
  sanitizeRichText,
  sanitizeFilename,
  sanitizeUrl,
  sanitizeObject,
} from "../../../lib/security/sanitize.js";

describe("sanitize", () => {
  describe("sanitizePlainText", () => {
    it("returns empty string for null input", () => {
      expect(sanitizePlainText(null as any)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(sanitizePlainText(undefined as any)).toBe("");
    });

    it("returns empty string for non-string input", () => {
      expect(sanitizePlainText(123 as any)).toBe("");
    });

    it("escapes HTML entities", () => {
      expect(sanitizePlainText("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
      );
    });

    it("trims whitespace", () => {
      expect(sanitizePlainText("  hello world  ")).toBe("hello world");
    });

    it("limits string length to 10000 characters", () => {
      const longString = "a".repeat(15000);
      expect(sanitizePlainText(longString).length).toBe(10000);
    });

    it("handles empty string", () => {
      expect(sanitizePlainText("")).toBe("");
    });

    it("handles special characters", () => {
      expect(sanitizePlainText("hello & world <test>")).toBe(
        "hello &amp; world &lt;test&gt;"
      );
    });
  });

  describe("sanitizeRichText", () => {
    it("returns empty string for null input", () => {
      expect(sanitizeRichText(null as any)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(sanitizeRichText(undefined as any)).toBe("");
    });

    it("returns empty string for non-string input", () => {
      expect(sanitizeRichText(123 as any)).toBe("");
    });

    it("allows safe HTML tags", () => {
      const input = "<p>Hello <strong>world</strong></p>";
      const result = sanitizeRichText(input);
      expect(result).toContain("<p>");
      expect(result).toContain("<strong>");
    });

    it("removes dangerous script tags", () => {
      const input = "<script>alert('xss')</script><p>safe</p>";
      const result = sanitizeRichText(input);
      expect(result).not.toContain("<script>");
      expect(result).toContain("<p>safe</p>");
    });

    it("removes dangerous attributes", () => {
      const input = '<a href="javascript:alert(1)">click</a>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain("javascript:");
    });

    it("limits string length to 50000 characters", () => {
      const longString = "<p>" + "a".repeat(60000) + "</p>";
      expect(sanitizeRichText(longString).length).toBeLessThanOrEqual(50000);
    });

    it("handles empty string", () => {
      expect(sanitizeRichText("")).toBe("");
    });
  });

  describe("sanitizeFilename", () => {
    it("returns 'file.txt' for null input", () => {
      expect(sanitizeFilename(null as any)).toBe("file.txt");
    });

    it("returns 'file.txt' for undefined input", () => {
      expect(sanitizeFilename(undefined as any)).toBe("file.txt");
    });

    it("returns 'file.txt' for non-string input", () => {
      expect(sanitizeFilename(123 as any)).toBe("file.txt");
    });

    it("removes path traversal sequences", () => {
      expect(sanitizeFilename("../../../etc/passwd")).toBe("___etc_passwd.txt");
    });

    it("replaces special characters with underscores", () => {
      expect(sanitizeFilename("file@name#test$here")).toBe("file_name_test_here.txt");
    });

    it("limits filename length to 255 characters", () => {
      const longFilename = "a".repeat(300) + ".txt";
      expect(sanitizeFilename(longFilename).length).toBeLessThanOrEqual(255);
    });

    it("adds .txt extension if no extension present", () => {
      expect(sanitizeFilename("filename")).toBe("filename.txt");
    });

    it("preserves existing extension", () => {
      expect(sanitizeFilename("filename.pdf")).toBe("filename.pdf");
    });

    it("handles empty string", () => {
      expect(sanitizeFilename("")).toBe("file.txt");
    });

    it("handles filenames with multiple dots", () => {
      expect(sanitizeFilename("file.name.test.pdf")).toBe("file.name.test.pdf");
    });
  });

  describe("sanitizeUrl", () => {
    it("returns empty string for null input", () => {
      expect(sanitizeUrl(null as any)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(sanitizeUrl(undefined as any)).toBe("");
    });

    it("returns empty string for non-string input", () => {
      expect(sanitizeUrl(123 as any)).toBe("");
    });

    it("accepts valid http URLs", () => {
      expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
    });

    it("accepts valid https URLs", () => {
      expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
    });

    it("rejects URLs without http/https protocol", () => {
      expect(sanitizeUrl("ftp://example.com")).toBe("");
    });

    it("rejects javascript: URLs", () => {
      expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    });

    it("rejects data: URLs", () => {
      expect(sanitizeUrl("data:text/html,<script>")).toBe("");
    });

    it("rejects vbscript: URLs", () => {
      expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("");
    });

    it("trims whitespace", () => {
      expect(sanitizeUrl("  https://example.com  ")).toBe("https://example.com");
    });

    it("handles malformed URLs", () => {
      expect(sanitizeUrl("not a url")).toBe("");
    });

    it("handles empty string", () => {
      expect(sanitizeUrl("")).toBe("");
    });
  });

  describe("sanitizeObject", () => {
    it("sanitizes string values in object", () => {
      const input = { name: "<script>alert(1)</script>", age: 25 };
      const result = sanitizeObject(input);
      expect(result.name).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(result.age).toBe(25);
    });

    it("sanitizes nested objects", () => {
      const input = {
        user: {
          name: "<b>test</b>",
          email: "test@example.com",
        },
      };
      const result = sanitizeObject(input);
      expect(result.user.name).toBe("&lt;b&gt;test&lt;/b&gt;");
      expect(result.user.email).toBe("test@example.com");
    });

    it("sanitizes object keys", () => {
      const input = { "<script>key</script>": "value" };
      const result = sanitizeObject(input);
      expect(Object.keys(result)[0]).toBe("&lt;script&gt;key&lt;/script&gt;");
    });

    it("preserves non-string values", () => {
      const input = {
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
      };
      const result = sanitizeObject(input);
      expect(result.number).toBe(42);
      expect(result.boolean).toBe(true);
      expect(result.null).toBe(null);
      expect(result.array).toEqual([1, 2, 3]);
    });

    it("handles empty object", () => {
      expect(sanitizeObject({})).toEqual({});
    });

    it("handles null input", () => {
      expect(sanitizeObject(null as any)).toBeNull();
    });

    it("handles deeply nested objects", () => {
      const input = {
        level1: {
          level2: {
            level3: {
              dangerous: "<script>alert(1)</script>",
            },
          },
        },
      };
      const result = sanitizeObject(input);
      expect(result.level1.level2.level3.dangerous).toBe(
        "&lt;script&gt;alert(1)&lt;/script&gt;"
      );
    });
  });
});