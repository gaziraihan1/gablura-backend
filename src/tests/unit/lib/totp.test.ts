import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("otplib", () => ({
  generateSecret: vi.fn(() => "MOCKBASE32SECRET"),
  generateURI: vi.fn((opts: { issuer?: string; label?: string; secret?: string }) => {
    const issuer = opts.issuer ? `${encodeURIComponent(opts.issuer)}:` : "";
    return `otpauth://totp/${issuer}${opts.label}?secret=${opts.secret}`;
  }),
  verify: vi.fn(),
}));

import { generateTOTPSecret, createTOTPURI, verifyTOTPToken } from "../../../lib/totp.js";
import { verify as mockVerify } from "otplib";

describe("lib/totp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("verifyTOTPToken", () => {
    it("returns true when otplib reports a valid result ({ valid: true })", async () => {
      vi.mocked(mockVerify).mockResolvedValue({ valid: true, delta: 0 } as never);
      await expect(verifyTOTPToken("123456", "SECRET")).resolves.toBe(true);
    });

    it("returns false when otplib reports an invalid result ({ valid: false })", async () => {
      vi.mocked(mockVerify).mockResolvedValue({ valid: false } as never);
      await expect(verifyTOTPToken("000000", "SECRET")).resolves.toBe(false);
    });

    it("returns false when otplib throws", async () => {
      vi.mocked(mockVerify).mockRejectedValue(new Error("otplib failure"));
      await expect(verifyTOTPToken("123456", "SECRET")).resolves.toBe(false);
    });

    it("never leaks the truthy result object to callers (invalid codes stay rejected)", async () => {
      // The object form is truthy — a regression here would accept any code.
      vi.mocked(mockVerify).mockResolvedValue({ valid: false } as never);
      const isValid = await verifyTOTPToken("wrong", "SECRET");
      expect(isValid).toBe(false);
    });
  });

  describe("generateTOTPSecret / createTOTPURI", () => {
    it("delegates secret generation to otplib", () => {
      expect(generateTOTPSecret()).toBe("MOCKBASE32SECRET");
    });

    it("builds an otpauth URI with the issuer and label", () => {
      const uri = createTOTPURI("MOCKBASE32SECRET", "user@focura.test");
      expect(uri).toContain("Focura:user@focura.test");
      expect(uri).toContain("secret=MOCKBASE32SECRET");
    });
  });
});
