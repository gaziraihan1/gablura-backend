/**
 * src/scripts/sync-frontend-contracts.ts
 *
 * Copies the canonical API wire contracts (src/lib/contracts/*.contract.ts)
 * into the frontend repo so both sides consume byte-identical definitions.
 * The contract files are dependency-free except for `zod`, which exists on
 * both sides (backend v4, frontend v3 — the schemas only use APIs common to
 * both major versions).
 *
 * Run with: npm run sync:contracts   (after changing any *.contract.ts file,
 * or in CI to detect drift with --check)
 *
 * Usage:
 *   tsx src/scripts/sync-frontend-contracts.ts           # write
 *   tsx src/scripts/sync-frontend-contracts.ts --check   # exit 1 if out of sync
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE_DIR = join(__dirname, "..", "lib", "contracts");
// __dirname = <backend>/src/scripts → up 3 = the folder containing both repos.
// Override with FRONTEND_REPO_ROOT if the client lives elsewhere.
const TARGET_DIR = join(
  process.env.FRONTEND_REPO_ROOT ??
    join(__dirname, "..", "..", "..", "Gablura-client", "gablura"),
  "types",
  "api-contracts",
);

const CONTRACT_FILES = ["project.contract.ts", "task.contract.ts"];
const CHECK_MODE = process.argv.includes("--check");

const drift: string[] = [];

for (const file of CONTRACT_FILES) {
  const source = readFileSync(join(SOURCE_DIR, file), "utf-8");
  const header =
    `/**\n` +
    ` * GENERATED FILE — do not edit directly.\n` +
    ` * Synced from gablura-backend/src/lib/contracts/${file} via \`npm run sync:contracts\`.\n` +
    ` * This is the single source of truth for the API wire format.\n` +
    ` */\n\n`;
  const targetContent = header + source;
  const targetPath = join(TARGET_DIR, file);

  if (CHECK_MODE) {
    let existing: string | null = null;
    try {
      existing = readFileSync(targetPath, "utf-8");
    } catch {
      /* missing file counts as drift */
    }
    if (existing !== targetContent) drift.push(file);
  } else {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, targetContent, "utf-8");
    console.log(`[sync:contracts] wrote ${targetPath}`);
  }
}

if (CHECK_MODE) {
  if (drift.length > 0) {
    console.error(
      `[sync:contracts] OUT OF SYNC — run \`npm run sync:contracts\` and commit:\n  ${drift.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log("[sync:contracts] in sync.");
}

process.exit(0);
