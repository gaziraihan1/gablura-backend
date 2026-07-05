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
import { writeFileSync, existsSync } from 'fs';
import { tmpdir }            from 'os';
import path                  from 'path';

const PRIVATE_KEY_PATH = path.join(tmpdir(), 'focura-test-private.pem');
const PUBLIC_KEY_PATH  = path.join(tmpdir(), 'focura-test-public.pem');

export async function setup() {
  // ── 1. RSA key pair ────────────────────────────────────────────────────────
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

  // ── 2. Push schema to test DB ──────────────────────────────────────────────
  const testDb = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!testDb) {
    throw new Error(
      '❌ No database URL found.\n' +
      'Add TEST_DATABASE_URL to .env.test'
    );
  }

  console.log('🔧 [globalSetup] Pushing schema to test database...');
  
  try {
    execSync('npx prisma migrate reset --force', {
      env: {
        ...process.env,
        DATABASE_URL: testDb,
        DIRECT_URL:   testDb,
        NODE_ENV:     'test',
      },
      stdio: 'pipe',
    });
    console.log('✅ [globalSetup] Test database ready.\n');
  } catch (err) {
    const msg = (err as any).stderr?.toString() ?? (err as Error).message;
    console.error('❌ [globalSetup] prisma db push failed:\n', msg);
    process.exit(1);
  }
}

export async function teardown() {
  // /tmp files cleaned by OS. Nothing to do.
}