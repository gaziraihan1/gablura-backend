// backend/src/payment/provider.registry.ts
//
// Single source of truth for which payment provider is active.
// Change PAYMENT_PROVIDER=lemonsqueezy (default), paddle, or stripe in .env.
//
// Usage (anywhere in the app):
//   import { getPaymentProvider } from '../payment/provider.registry';
//   const provider = getPaymentProvider();
//   const result   = await provider.createCheckoutSession(params);
// ─────────────────────────────────────────────────────────────────────────────

import type { IPaymentProvider } from './IpaymentProvider.js';
import { StripeProvider }        from './providers/stripe/stripe.provider.js';
import { PaddleProvider }        from './providers/paddle/paddle.provider.js';
import { LemonSqueezyProvider }  from './providers/lemonsqueezy/lemonsqueezy.provider.js';
import { validateLemonSqueezyConfig } from '../modules/billing/config/lemonsqueezy.js';

type SupportedProvider = 'stripe' | 'paddle' | 'lemonsqueezy';

// Module-level singleton — instantiated once at server start
let instance: IPaymentProvider | null = null;

export function getPaymentProvider(): IPaymentProvider {
  if (instance) return instance;

  const name = (process.env.PAYMENT_PROVIDER ?? 'lemonsqueezy').toLowerCase() as SupportedProvider;

  switch (name) {
    case 'stripe':
      instance = new StripeProvider();
      break;
    case 'paddle':
      instance = new PaddleProvider();
      break;
    case 'lemonsqueezy':
      validateLemonSqueezyConfig();
      instance = new LemonSqueezyProvider();
      break;
    default:
      throw new Error(
        `[PaymentRegistry] Unknown PAYMENT_PROVIDER="${name}". Supported: stripe, paddle, lemonsqueezy`
      );
  }

  console.log(`[PaymentRegistry] Active provider: ${instance.name}`);
  return instance;
}

// Exposed for testing — lets tests inject a mock provider
export function setPaymentProvider(provider: IPaymentProvider): void {
  instance = provider;
}

// Reset — used between tests
export function resetPaymentProvider(): void {
  instance = null;
}