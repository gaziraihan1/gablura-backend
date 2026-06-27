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
 * Dynamic sizing based on environment variables:
 *
 *   DB_MAX_CONNECTIONS: Maximum connections allowed by your database plan
 *   INSTANCE_COUNT: Number of application instances (default: 1)
 *   PRIMARY_POOL_RATIO: Ratio of connections for primary pool (default: 0.3)
 *   REPLICA_POOL_RATIO: Ratio of connections for read replica pool (default: 0.7)
 *
 * Formula: connection_limit = floor((max_connections - 3) / num_instances * ratio)
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

// ─── Configuration ─────────────────────────────────────────────────────────────

const INSTANCE_COUNT = parseInt(process.env.INSTANCE_COUNT ?? "1");
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS ?? "100");
const PRIMARY_POOL_RATIO = parseFloat(process.env.PRIMARY_POOL_RATIO ?? "0.3");
const REPLICA_POOL_RATIO = parseFloat(process.env.REPLICA_POOL_RATIO ?? "0.7");
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS ?? "30000");

// Calculate available connections (reserve 3 for superuser/maintenance)
const availableConnections = Math.max(1, DB_MAX_CONNECTIONS - 3);
const connectionsPerInstance = Math.floor(availableConnections / INSTANCE_COUNT);

// Calculate pool sizes
const primaryPoolSize = Math.max(2, Math.floor(connectionsPerInstance * PRIMARY_POOL_RATIO));
const replicaPoolSize = Math.max(2, Math.floor(connectionsPerInstance * REPLICA_POOL_RATIO));

// Log configuration in development
if (process.env.NODE_ENV === "development") {
  console.log("🔧 Database Connection Pool Configuration:");
  console.log(`   Instances: ${INSTANCE_COUNT}`);
  console.log(`   DB Max Connections: ${DB_MAX_CONNECTIONS}`);
  console.log(`   Available Connections: ${availableConnections}`);
  console.log(`   Primary Pool Size: ${primaryPoolSize}`);
  console.log(`   Replica Pool Size: ${replicaPoolSize}`);
  console.log(`   Query Timeout: ${QUERY_TIMEOUT_MS}ms`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDsn(base: string, connectionLimit: number): string {
  const url = new URL(base);
  url.searchParams.set("connection_limit", String(connectionLimit));
  // Statement cache size reduces parse overhead for repeated queries
  url.searchParams.set("statement_cache_size", "100");
  // Connection timeout to prevent hanging
  url.searchParams.set("connect_timeout", "10");
  return url.toString();
}

// ─── Connection pool monitoring ─────────────────────────────────────────────

interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
}

let poolMetrics: PoolMetrics = {
  totalConnections: 0,
  activeConnections: 0,
  idleConnections: 0,
  waitingRequests: 0,
};

export function getPoolMetrics(): PoolMetrics {
  return { ...poolMetrics };
}

// ─── Primary client (read-write) ─────────────────────────────────────────────

const PRIMARY_URL = process.env.DATABASE_URL;
if (!PRIMARY_URL) throw new Error("DATABASE_URL env variable is required");

const _prisma = new PrismaClient({
  datasources: {
    db: { url: buildDsn(PRIMARY_URL, primaryPoolSize) },
  },
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "warn", "error"]
      : ["warn", "error"],
});

// Add query timeout middleware
_prisma.$use(async (params, next) => {
  const startTime = Date.now();
  
  try {
    const result = await Promise.race([
      next(params),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Query timeout")), QUERY_TIMEOUT_MS)
      )
    ]) as any;
    
    const duration = Date.now() - startTime;
    if (duration > QUERY_TIMEOUT_MS * 0.8) {
      console.warn(`⚠️  Slow query detected: ${params.model}.${params.action} took ${duration}ms`);
    }
    
    return result;
  } catch (error: any) {
    if (error.message === "Query timeout") {
      console.error(`❌ Query timeout: ${params.model}.${params.action} exceeded ${QUERY_TIMEOUT_MS}ms`);
      throw new Error("Database query timeout - please try again");
    }
    throw error;
  }
});

// ─── Read replica client ──────────────────────────────────────────────────────

const READ_URL = process.env.READ_DATABASE_URL ?? PRIMARY_URL;

const _prismaRead = new PrismaClient({
  datasources: {
    db: { url: buildDsn(READ_URL, replicaPoolSize) },
  },
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

// Add query timeout middleware for read replica
_prismaRead.$use(async (params, next) => {
  const startTime = Date.now();
  
  try {
    const result = await Promise.race([
      next(params),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Query timeout")), QUERY_TIMEOUT_MS)
      )
    ]) as any;
    
    const duration = Date.now() - startTime;
    if (duration > QUERY_TIMEOUT_MS * 0.8) {
      console.warn(`⚠️  Slow read query detected: ${params.model}.${params.action} took ${duration}ms`);
    }
    
    return result;
  } catch (error: any) {
    if (error.message === "Query timeout") {
      console.error(`❌ Read query timeout: ${params.model}.${params.action} exceeded ${QUERY_TIMEOUT_MS}ms`);
      throw new Error("Database query timeout - please try again");
    }
    throw error;
  }
});

// ─── Connection health check ───────────────────────────────────────────────────

export async function checkDatabaseHealth(): Promise<{
  primary: boolean;
  replica: boolean;
  latency: { primary: number; replica: number };
}> {
  const startTime = Date.now();
  
  try {
    await _prisma.$queryRaw`SELECT 1`;
    const primaryLatency = Date.now() - startTime;
    
    const replicaStartTime = Date.now();
    await _prismaRead.$queryRaw`SELECT 1`;
    const replicaLatency = Date.now() - replicaStartTime;
    
    return {
      primary: true,
      replica: true,
      latency: { primary: primaryLatency, replica: replicaLatency },
    };
  } catch (error) {
    console.error("Database health check failed:", error);
    return {
      primary: false,
      replica: false,
      latency: { primary: -1, replica: -1 },
    };
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function disconnectAll(): Promise<void> {
  console.log("🔄 Disconnecting database connections...");
  try {
    await Promise.all([
      _prisma.$disconnect(),
      _prismaRead.$disconnect(),
    ]);
    console.log("✅ Database connections closed");
  } catch (error) {
    console.error("❌ Error disconnecting databases:", error);
  }
}

// Remove duplicate signal handlers since they're handled in index.ts
// This function is exported for manual use if needed
export { disconnectAll };

// ─── Exports ──────────────────────────────────────────────────────────────────

/** Primary read-write client — use for mutations and consistency-critical reads */
export const prisma = _prisma;

/**
 * Read-replica client — use for analytics, feeds, lists, calendar, stats.
 * Falls back to primary if READ_DATABASE_URL is not configured.
 */
export const prismaRead = _prismaRead;