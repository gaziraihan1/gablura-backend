import { Request, Response, NextFunction } from "express";
import { getPoolMetrics } from "../lib/prisma.js";

/**
 * Database connection monitoring middleware
 * Tracks connection pool usage and logs warnings when approaching limits
 */
export function dbMonitoring(req: Request, res: Response, next: NextFunction) {
  const poolMetrics = getPoolMetrics();
  const utilization = poolMetrics.totalConnections > 0 
    ? (poolMetrics.activeConnections / poolMetrics.totalConnections) * 100 
    : 0;

  // Log warnings when pool utilization is high
  if (utilization > 80) {
    console.warn(`⚠️  High database connection pool utilization: ${utilization.toFixed(1)}%`);
    console.warn(`   Active: ${poolMetrics.activeConnections}/${poolMetrics.totalConnections}`);
    console.warn(`   Waiting: ${poolMetrics.waitingRequests}`);
  }

  // Add pool metrics to response headers for monitoring
  res.setHeader("X-DB-Pool-Total", poolMetrics.totalConnections.toString());
  res.setHeader("X-DB-Pool-Active", poolMetrics.activeConnections.toString());
  res.setHeader("X-DB-Pool-Idle", poolMetrics.idleConnections.toString());
  res.setHeader("X-DB-Pool-Waiting", poolMetrics.waitingRequests.toString());

  next();
}

/**
 * Rate limiting middleware based on database connection pool health
 * Rejects requests when pool is exhausted to prevent cascading failures
 */
export function dbPoolGuard(req: Request, res: Response, next: NextFunction) {
  const poolMetrics = getPoolMetrics();
  const utilization = poolMetrics.totalConnections > 0 
    ? (poolMetrics.activeConnections / poolMetrics.totalConnections) * 100 
    : 0;

  // Reject requests if pool is completely exhausted
  if (utilization >= 95) {
    console.error(`❌ Database connection pool exhausted: ${utilization.toFixed(1)}%`);
    return res.status(503).json({
      error: "Service temporarily unavailable",
      message: "Database connection pool exhausted. Please try again later.",
      retryAfter: 5, // Suggest retry after 5 seconds
    });
  }

  // Add warning header when approaching limits
  if (utilization > 75) {
    res.setHeader("X-DB-Pool-Warning", "high-utilization");
  }

  next();
}