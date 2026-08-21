// backend/src/modules/billing/config/lemonsqueezy.ts
//
// Lemon Squeezy configuration — lazy singleton client, variant ID mapping,
// and webhook secret accessor. Follows the same pattern as paddle.ts.
//
// Lemon Squeezy uses "variants" instead of "price IDs". Each variant represents
// a specific pricing option for a product (e.g., PRO monthly, PRO yearly).
// ─────────────────────────────────────────────────────────────────────────────

import {
  lemonSqueezySetup,
  createCustomer,
  createCheckout,
  getCustomer,
  getSubscription,
  updateSubscription,
  cancelSubscription,
} from '@lemonsqueezy/lemonsqueezy.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface LemonSqueezyVariantConfig {
  monthly: string;  // variant ID
  yearly: string;   // variant ID
}

export interface LemonSqueezyPlanMapping {
  planName: string;
  cycle: BillingCycle;
}

// Re-export SDK functions for use by the provider
export {
  createCustomer,
  createCheckout,
  getCustomer,
  getSubscription,
  updateSubscription,
  cancelSubscription,
};

// ---------------------------------------------------------------------------
// Lazy client — SDK initialised once on first use
// ---------------------------------------------------------------------------

let isSetup = false;

export function setupLemonSqueezy(): void {
  if (isSetup) return;

  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) {
    // In production this is fatal — but during module loading (e.g. when
    // PAYMENT_PROVIDER=stripe), we just warn so the server can still start.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[LemonSqueezy] LEMONSQUEEZY_API_KEY is not defined');
    }
    console.warn('[LemonSqueezy] LEMONSQUEEZY_API_KEY is not defined — SDK not initialised');
    return;
  }

  lemonSqueezySetup({
    apiKey,
    onError: (error: Error) => console.error('[LemonSqueezy] SDK Error:', error),
  });

  isSetup = true;
}

// ---------------------------------------------------------------------------
// Store ID
// ---------------------------------------------------------------------------

export function getLemonSqueezyStoreId(): string {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!storeId) {
    throw new Error('[LemonSqueezy] LEMONSQUEEZY_STORE_ID is not defined');
  }
  return storeId;
}

// ---------------------------------------------------------------------------
// Variant ID mapping (equivalent to PADDLE_PRICE_IDS)
// ---------------------------------------------------------------------------

export const LEMONSQUEEZY_VARIANT_IDS: Record<string, LemonSqueezyVariantConfig> = {
  PRO: {
    monthly: process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY ?? '',
    yearly: process.env.LEMONSQUEEZY_VARIANT_PRO_YEARLY ?? '',
  },
  BUSINESS: {
    monthly: process.env.LEMONSQUEEZY_VARIANT_BUSINESS_MONTHLY ?? '',
    yearly: process.env.LEMONSQUEEZY_VARIANT_BUSINESS_YEARLY ?? '',
  },
};

// Reverse mapping: variant ID → plan info (equivalent to PADDLE_PRICE_TO_PLAN)
export const LEMONSQUEEZY_VARIANT_TO_PLAN: Map<string, LemonSqueezyPlanMapping> = new Map();

for (const [planName, variants] of Object.entries(LEMONSQUEEZY_VARIANT_IDS)) {
  if (variants.monthly) {
    LEMONSQUEEZY_VARIANT_TO_PLAN.set(variants.monthly, {
      planName,
      cycle: 'MONTHLY',
    });
  }
  if (variants.yearly) {
    LEMONSQUEEZY_VARIANT_TO_PLAN.set(variants.yearly, {
      planName,
      cycle: 'YEARLY',
    });
  }
}

// ---------------------------------------------------------------------------
// Webhook secret
// ---------------------------------------------------------------------------

export function getLemonSqueezyWebhookSecret(): string {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('[LemonSqueezy] LEMONSQUEEZY_WEBHOOK_SECRET is not defined');
  }
  return secret;
}

// NOTE: Webhook signature verification (HMAC-SHA256) is handled by the
// LemonSqueezyProvider.verifyAndParseWebhook() method, which uses the
// `crypto` module directly. This keeps verification logic co-located with
// the provider and avoids duplication.

// ---------------------------------------------------------------------------
// Price resolver (equivalent to Paddle's resolvePriceId)
// ---------------------------------------------------------------------------

export function resolveLemonSqueezyVariantId(
  planName: string,
  billingCycle: BillingCycle,
): string {
  const variants = LEMONSQUEEZY_VARIANT_IDS[planName];
  if (!variants) {
    throw new Error(`[LemonSqueezy] No variant config for plan: ${planName}`);
  }

  const variantId = billingCycle === 'YEARLY' ? variants.yearly : variants.monthly;
  if (!variantId) {
    throw new Error(
      `[LemonSqueezy] Missing variant for ${planName}_${billingCycle} — set LEMONSQUEEZY_VARIANT_${planName}_${billingCycle} in .env`
    );
  }

  return variantId;
}

// ---------------------------------------------------------------------------
// Startup validation — called by the provider registry when LS is active
// ---------------------------------------------------------------------------

export function validateLemonSqueezyConfig(): void {
  const required = [
    'LEMONSQUEEZY_API_KEY',
    'LEMONSQUEEZY_STORE_ID',
    'LEMONSQUEEZY_WEBHOOK_SECRET',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[LemonSqueezy] Missing required env vars: ${missing.join(', ')}
` +
      `See README.md for the full list of LEMONSQUEEZY_* environment variables.`
    );
  }

  // Warn about missing variant IDs (non-fatal but checkout/changePlan will fail)
  const variantWarnings: string[] = [];
  for (const [plan, cfg] of Object.entries(LEMONSQUEEZY_VARIANT_IDS)) {
    if (!cfg.monthly) variantWarnings.push(`LEMONSQUEEZY_VARIANT_${plan}_MONTHLY`);
    if (!cfg.yearly) variantWarnings.push(`LEMONSQUEEZY_VARIANT_${plan}_YEARLY`);
  }
  if (variantWarnings.length > 0) {
    console.warn(
      `[LemonSqueezy] Missing variant IDs — checkout/changePlan for these plans will fail: ${variantWarnings.join(', ')}
` +
      `Set them in .env as LEMONSQUEEZY_VARIANT_<PLAN>_MONTHLY / YEARLY.`
    );
  }
}
