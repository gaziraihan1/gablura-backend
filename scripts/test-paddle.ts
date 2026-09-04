// scripts/test-paddle.ts
import 'dotenv/config';

import { getPaddle } from '../src/modules/billing/config/paddle.js';

async function testPaddle() {
  console.log('Testing Paddle connection...\n');

  try {
    // Initialize Paddle (lazy + safe)
    const paddle = getPaddle();

    // Test 1 — Create a customer
    const customer = await paddle.customers.create({
      email: 'test@gablura0.dev',
      name: 'Test User',
    });

    console.log('✅ Customer created:', customer.id);

    // Test 2 — List prices
    const prices = await paddle.prices.list();

    let priceCount = 0;

    for await (const price of prices) {
      console.log(
        `   - ${price.id} | ${price.name ?? 'No name'} | ${price.status}`
      );
      priceCount++;
    }

    console.log(`✅ Prices found: ${priceCount}`);

    // Test 3 — Fetch customer back
    const fetched = await paddle.customers.get(customer.id);

    console.log('✅ Customer fetch works:', fetched.email);

    console.log('\n✅ Paddle is working correctly.');
  } catch (err) {
    console.error('❌ Paddle error:', err);
  }
}

testPaddle();