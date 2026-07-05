/**
 * Performance Test Token Generator
 * 
 * Creates a dedicated performance test user in the database and 
 * generates a valid JWT access token for authenticated scenarios.
 */

import { PrismaClient } from '@prisma/client';
import { createTokenPair } from '../src/lib/auth/backendToken.js';

const prisma = new PrismaClient();

async function main() {
  try {
    // Ensure a performance test user exists
    const user = await prisma.user.upsert({
      where: { email: 'perf-test@example.com' },
      update: {},
      create: {
        email: 'perf-test@example.com',
        name: 'Performance Test User',
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    });

    // Generate a token pair
    const tokens = createTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: 'perf-session-id',
    });

    // Output only the access token to stdout for easy capture in CI
    process.stdout.write(tokens.accessToken);
  } catch (error) {
    console.error('Error generating performance token:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
