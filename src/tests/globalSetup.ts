// src/tests/globalSetup.ts
// ─────────────────────────────────────────────────────────────────────────────
// Runs ONCE in a separate process before Vitest forks any workers.
//
// KEY INSIGHT about env propagation:
//   process.env mutations in globalSetup ARE inherited by workers IF they are
//   set before Vitest forks. This works for string values.
//   However writing large PEM keys as env vars can cause issues on Windows
//   (env var size limits). So we write to disk AND set the path.
//
// Workers read:
//   TEST_JWT_PRIVATE_KEY_PATH → path to private key PEM file on disk
//   JWT_PUBLIC_KEY            → base64 public key (read by auth.ts middleware)
// ─────────────────────────────────────────────────────────────────────────────

import { execSync }          from 'child_process';
import { generateKeyPairSync } from 'crypto';
import { writeFileSync, existsSync, unlinkSync, renameSync } from 'fs';
import { tmpdir }            from 'os';
import path                  from 'path';

const PRIVATE_KEY_PATH = path.join(tmpdir(), 'focura-test-private.pem');
const PUBLIC_KEY_PATH  = path.join(tmpdir(), 'focura-test-public.pem');

export async function setup() {
  // ── 1. Clean up any existing keys ────────────────────────────────────────────
  if (existsSync(PRIVATE_KEY_PATH)) {
    try { unlinkSync(PRIVATE_KEY_PATH); } catch { /* file may not exist */ }
  }
  if (existsSync(PUBLIC_KEY_PATH)) {
    try { unlinkSync(PUBLIC_KEY_PATH); } catch { /* file may not exist */ }
  }

  // ── 2. RSA key pair ────────────────────────────────────────────────────────
  console.log('\n🔑 [globalSetup] Generating RSA-2048 key pair for tests...');
  
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH,  publicKey,  { mode: 0o644 });

  // These env vars ARE passed to workers (set before Vitest forks)
  process.env.TEST_JWT_PRIVATE_KEY_PATH = PRIVATE_KEY_PATH;
  process.env.JWT_PRIVATE_KEY_PATH = PRIVATE_KEY_PATH;
  process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey).toString('base64');
  // base64-encoded — matches how auth.ts reads JWT_PUBLIC_KEY from env
  process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');

  console.log(`✅ [globalSetup] Private key: ${PRIVATE_KEY_PATH}`);
  console.log(`✅ [globalSetup] JWT_PUBLIC_KEY set (${publicKey.length} chars PEM → base64)`);

  // ── 3. Disable Sentry in tests ───────────────────────────────────────────────
  // Sentry can interfere with tests and cause timeouts
  process.env.SENTRY_DSN = '';
  process.env.SENTRY_ENVIRONMENT = 'test';

  // ── 4. Set test secret for HMAC signatures ───────────────────────────────────
  process.env.NEXTAUTH_SECRET = 'test-secret-key-for-auth-tests';

  // ── 5. Push schema to test DB ──────────────────────────────────────────────
  const testDb = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!testDb) {
    throw new Error(
      '❌ No database URL found.\n' +
      'Add TEST_DATABASE_URL to .env.test or DATABASE_URL to .env'
    );
  }

  console.log('🔧 [globalSetup] Pushing schema to test database...');

  // Prisma CLI always loads .env which overrides process.env.
  // Temporarily rename .env so our passed DATABASE_URL takes effect,
  // then restore it after the push/seed commands complete.
  const envPath = path.join(process.cwd(), '.env');
  const envBakPath = envPath + '.bak';
  let hadEnv = false;
  if (existsSync(envPath)) {
    renameSync(envPath, envBakPath);
    hadEnv = true;
  }

  let pushError: Error | null = null;

  try {
    execSync('npx prisma db push --force-reset', {
      env: {
        ...process.env,
        DATABASE_URL: testDb,
        DIRECT_URL:   testDb,
        NODE_ENV:     'test',
      },
      stdio: 'pipe',
      timeout: 60000,
    });

    console.log('🌱 [globalSetup] Seeding test database...');
    execSync('npm run db:seed', {
      env: {
        ...process.env,
        DATABASE_URL: testDb,
        DIRECT_URL:   testDb,
        NODE_ENV:     'test',
      },
      stdio: 'pipe',
      timeout: 60000,
    });

    console.log('✅ [globalSetup] Test database ready and seeded.\n');
  } catch (err) {
    pushError = err as Error;
  } finally {
    if (hadEnv) {
      try { renameSync(envBakPath, envPath); } catch { /* file may not exist */ }
    }
  }

  if (pushError) {
    const msg = (pushError as any).stderr?.toString() ?? pushError.message;
    console.error('❌ [globalSetup] failed:\n', msg);
    process.exit(1);
  }
}

export async function teardown() {
  // Clean up key files
  try {
    if (existsSync(PRIVATE_KEY_PATH)) {
      unlinkSync(PRIVATE_KEY_PATH);
    }
    if (existsSync(PUBLIC_KEY_PATH)) {
      unlinkSync(PUBLIC_KEY_PATH);
    }
  } catch (err) {
    console.warn('[globalSetup] Warning: Could not clean up key files:', err);
  }
}