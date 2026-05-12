/**
 * src/lib/prisma.ts
 *
 * Two Prisma clients:
 *
 *   prisma       — primary (read-write). Use for all mutations and
 *                  queries that must see the latest committed data.
 *
 *   prismaRead   — read replica (read-only). Use for read-heavy,
 *                  latency-tolerant queries: analytics, calendar
 *                  aggregates, activity feeds, notification lists,
 *                  task list views, storage stats, etc.
 *
 * Connection pooling
 * ──────────────────
 * Prisma uses its own connection pool per client instance.
 * Recommended sizes for a typical Railway / Render 512 MB container:
 *
 *   Primary:     connection_limit=5   (writes + critical reads)
 *   Read replica: connection_limit=10  (concurrent dashboard queries)
 *
 * Adjust these to match your DB plan's max_connections.
 * Formula: connection_limit ≤ (max_connections - 3) / num_instances
 *
 * If you're on Supabase/Neon with PgBouncer, set pool_mode=transaction
 * in the connection string and lower connection_limit to 2-3.
 *
 * Read replica fallback
 * ──────────────────────
 * If READ_DATABASE_URL is not set, prismaRead falls back to DATABASE_URL.
 * This means you can deploy without a replica and promote one later with
 * zero code changes.
 */

import { PrismaClient } from "@prisma/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDsn(base: string, connectionLimit: number): string {
  const url = new URL(base);
  url.searchParams.set("connection_limit", String(connectionLimit));
  // Optional: statement_cache_size reduces parse overhead for repeated queries
  url.searchParams.set("statement_cache_size", "50");
  return url.toString();
}

// ─── Primary client (read-write) ─────────────────────────────────────────────

const PRIMARY_URL = process.env.DATABASE_URL;
if (!PRIMARY_URL) throw new Error("DATABASE_URL env variable is required");

const _prisma = new PrismaClient({
  datasources: {
    db: { url: buildDsn(PRIMARY_URL, 5) },
  },
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "warn", "error"]
      : ["warn", "error"],
});

// ─── Read replica client ──────────────────────────────────────────────────────

const READ_URL = process.env.READ_DATABASE_URL ?? PRIMARY_URL;

const _prismaRead = new PrismaClient({
  datasources: {
    db: { url: buildDsn(READ_URL, 10) },
  },
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function disconnectAll(): Promise<void> {
  await Promise.all([_prisma.$disconnect(), _prismaRead.$disconnect()]);
}

process.on("SIGTERM", disconnectAll);
process.on("SIGINT", disconnectAll);

// ─── Exports ──────────────────────────────────────────────────────────────────

/** Primary read-write client — use for mutations and consistency-critical reads */
export const prisma = _prisma;

/**
 * Read-replica client — use for analytics, feeds, lists, calendar, stats.
 * Falls back to primary if READ_DATABASE_URL is not configured.
 */
export const prismaRead = _prismaRead;