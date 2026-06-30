import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the provider implementations
vi.mock("../../../payment/providers/stripe/stripe.provider.js", () => ({
  StripeProvider: vi.fn().mockImplementation(() => ({
    name: "stripe",
  })),
}));

vi.mock("../../../payment/providers/paddle/paddle.provider.js", () => ({
  PaddleProvider: vi.fn().mockImplementation(() => ({
    name: "paddle",
  })),
}));

import {
  getPaymentProvider,
  setPaymentProvider,
  resetPaymentProvider,
} from "../../../payment/provider.registry.js";
import { StripeProvider } from "../../../payment/providers/stripe/stripe.provider.js";
import { PaddleProvider } from "../../../payment/providers/paddle/paddle.provider.js";

describe("provider.registry", () => {
  beforeEach(() => {
    resetPaymentProvider();
    vi.clearAllMocks();
  });

  describe("getPaymentProvider", () => {
    it("returns Stripe provider when PAYMENT_PROVIDER is stripe", () => {
      process.env.PAYMENT_PROVIDER = "stripe";
      const provider = getPaymentProvider();
      expect(provider.name).toBe("stripe");
      expect(StripeProvider).toHaveBeenCalled();
    });

    it("returns Paddle provider when PAYMENT_PROVIDER is paddle", () => {
      process.env.PAYMENT_PROVIDER = "paddle";
      const provider = getPaymentProvider();
      expect(provider.name).toBe("paddle");
      expect(PaddleProvider).toHaveBeenCalled();
    });

    it("defaults to Stripe when PAYMENT_PROVIDER is not set", () => {
      delete process.env.PAYMENT_PROVIDER;
      const provider = getPaymentProvider();
      expect(provider.name).toBe("stripe");
      expect(StripeProvider).toHaveBeenCalled();
    });

    it("throws error for unknown provider", () => {
      process.env.PAYMENT_PROVIDER = "unknown";
      expect(() => getPaymentProvider()).toThrow(
        '[PaymentRegistry] Unknown PAYMENT_PROVIDER="unknown". Supported: stripe, paddle'
      );
    });

    it("returns cached instance on subsequent calls", () => {
      process.env.PAYMENT_PROVIDER = "stripe";
      const provider1 = getPaymentProvider();
      const provider2 = getPaymentProvider();
      expect(provider1).toBe(provider2);
      expect(StripeProvider).toHaveBeenCalledTimes(1);
    });

    it("handles case-insensitive provider names", () => {
      process.env.PAYMENT_PROVIDER = "STRIPE";
      const provider = getPaymentProvider();
      expect(provider.name).toBe("stripe");
    });
  });

  describe("setPaymentProvider", () => {
    it("allows setting a custom provider", () => {
      const mockProvider = { name: "mock" };
      setPaymentProvider(mockProvider as any);
      const provider = getPaymentProvider();
      expect(provider).toBe(mockProvider);
    });

    it("overrides existing provider", () => {
      process.env.PAYMENT_PROVIDER = "stripe";
      getPaymentProvider(); // Create stripe instance

      const mockProvider = { name: "mock" };
      setPaymentProvider(mockProvider as any);
      const provider = getPaymentProvider();
      expect(provider).toBe(mockProvider);
    });
  });

  describe("resetPaymentProvider", () => {
    it("clears the cached provider instance", () => {
      process.env.PAYMENT_PROVIDER = "stripe";
      getPaymentProvider(); // Create instance
      resetPaymentProvider();

      process.env.PAYMENT_PROVIDER = "paddle";
      const provider = getPaymentProvider();
      expect(provider.name).toBe("paddle");
      expect(PaddleProvider).toHaveBeenCalled();
    });

    it("allows creating new instance after reset", () => {
      process.env.PAYMENT_PROVIDER = "stripe";
      const provider1 = getPaymentProvider();
      resetPaymentProvider();
      const provider2 = getPaymentProvider();

      expect(provider1).not.toBe(provider2);
      expect(StripeProvider).toHaveBeenCalledTimes(2);
    });
  });
});