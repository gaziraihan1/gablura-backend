// vitest.config.ts  (root of project)
import { defineConfig } from 'vitest/config';
import path             from 'path';
import { fileURLToPath } from 'url';
import { readFileSync }  from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env.test before anything else ──────────────────────────────────────
// Vitest's built-in envFile support loads AFTER globalSetup starts.
// We do it manually here so variables are in process.env for the entire run.
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && val !== undefined) env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

const testEnv = parseEnvFile(path.resolve(__dirname, '.env.test'));
// Apply to process.env NOW so globalSetup inherits them
Object.assign(process.env, testEnv);

export default defineConfig({
  resolve: {
    alias: {
      // Clean imports in test files:
      //   import app from 'tests/../app.js'
      //   import { createUser } from 'tests/factories/index.js'
      tests: path.resolve(__dirname, 'src/tests'),
    },
  },

  test: {
    environment: 'node',
    globals:     true,

    // Propagate the parsed env to workers too
    env: testEnv,

    // globalSetup: ONE-TIME setup (generates RSA keys + pushes DB schema)
    globalSetup: ['./src/tests/globalSetup.ts'],

    // setupFiles: runs in EACH worker before every test file
    setupFiles:  ['./src/tests/setup.ts'],

    // singleFork prevents "prepared statement already exists" PG errors
    // and connection pool exhaustion when many workers hit the same DB.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    // Test file discovery
    include: ['src/tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],

    // Timeouts — integration tests hit real DB
    testTimeout:  25000,
    hookTimeout:  30000,

    // Coverage
    coverage: {
      provider:         'v8',
      reporter:         ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**', 'dist/**', 'src/tests/**',
        'prisma/**', '**/*.d.ts', 'src/index.ts', 'src/payment/**',
      ],
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },

    reporters: ['verbose'],
  },
});