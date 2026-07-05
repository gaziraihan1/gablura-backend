/**
 * Database Performance Tests
 *
 * Focused performance tests for database operations.
 * Tests query performance, connection pool behavior, and database-specific metrics.
 */

import { PrismaClient } from "@prisma/client";
import { performance } from "perf_hooks";

interface DbTestResult {
  name: string;
  success: boolean;
  duration: number;
  operations: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  minLatency: number;
  maxLatency: number;
  throughput: number;
  errors: number;
}

class DatabasePerformanceTester {
  private prisma: PrismaClient;
  private prismaRead: PrismaClient;
  private latencies: number[] = [];

  constructor() {
    this.prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });

    this.prismaRead = new PrismaClient({
      datasources: {
        db: { url: process.env.READ_DATABASE_URL || process.env.DATABASE_URL },
      },
    });
  }

  async cleanup() {
    await this.prisma.$disconnect();
    await this.prismaRead.$disconnect();
  }

  private resetLatencies() {
    this.latencies = [];
  }

  private recordLatency(latency: number) {
    this.latencies.push(latency);
  }

  private calculateLatencyMetrics() {
    if (this.latencies.length === 0) {
      return { average: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    return {
      average: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }

  async testSimpleReadOperations(count: number = 1000): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Simple Read Operations");
    console.log(`   Operations: ${count}`);

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < count; i++) {
      const opStart = performance.now();
      try {
        // Simple user query
        await this.prismaRead.user.findFirst({
          select: { id: true, email: true },
        });
        this.recordLatency(performance.now() - opStart);
      } catch  {
        errors++;
        this.recordLatency(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(count / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Simple Read Operations",
      success: errors === 0,
      duration,
      operations: count,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: count / (duration / 1000),
      errors,
    };
  }

  async testComplexReadOperations(count: number = 500): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Complex Read Operations (with joins)");
    console.log(`   Operations: ${count}`);

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < count; i++) {
      const opStart = performance.now();
      try {
        // Complex query with relations
        await this.prismaRead.task.findMany({
          include: {
            assignees: true,
            labels: true,
            project: {
              include: {
                members: true,
              },
            },
          },
          take: 10,
        });
        this.recordLatency(performance.now() - opStart);
      } catch {
        errors++;
        this.recordLatency(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(count / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Complex Read Operations",
      success: errors === 0,
      duration,
      operations: count,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: count / (duration / 1000),
      errors,
    };
  }

  async testWriteOperations(count: number = 200): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Write Operations");
    console.log(`   Operations: ${count}`);

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;
    const createdIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const opStart = performance.now();
      try {
        const task = await this.prisma.task.create({
          data: {
            title: `Performance Test Task ${i}`,
            description: "Task created during database performance testing",
            status: "TODO",
            priority: "MEDIUM",
            projectId: "test-project-id", // This should be a valid project ID
            createdById: "test-user-id",
          },
        });
        createdIds.push(task.id);
        this.recordLatency(performance.now() - opStart);
      } catch {
        errors++;
        this.recordLatency(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    // Cleanup created tasks
    if (createdIds.length > 0) {
      await this.prisma.task.deleteMany({
        where: { id: { in: createdIds } },
      });
    }

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(count / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Write Operations",
      success: errors === 0,
      duration,
      operations: count,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: count / (duration / 1000),
      errors,
    };
  }

  async testUpdateOperations(count: number = 300): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Update Operations");
    console.log(`   Operations: ${count}`);

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;

    // First, create a test task
    let testTask;
    try {
      testTask = await this.prisma.task.create({
        data: {
          title: "Performance Test Task for Updates",
          status: "TODO",
          priority: "MEDIUM",
          projectId: "test-project-id",
          createdById: "test-user-id",
        },
      });
    } catch (error) {
      console.error("Failed to create test task for update operations");
      throw error;
    }

    for (let i = 0; i < count; i++) {
      const opStart = performance.now();
      try {
        await this.prisma.task.update({
          where: { id: testTask.id },
          data: {
            title: `Updated Task ${i}`,
            status: i % 2 === 0 ? "TODO" : "IN_PROGRESS",
          },
        });
        this.recordLatency(performance.now() - opStart);
      } catch {
        errors++;
        this.recordLatency(performance.now() - opStart);
      }
    }

    // Cleanup
    await this.prisma.task.delete({ where: { id: testTask.id } });

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(count / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Update Operations",
      success: errors === 0,
      duration,
      operations: count,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: count / (duration / 1000),
      errors,
    };
  }

  async testDeleteOperations(count: number = 100): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Delete Operations");
    console.log(`   Operations: ${count}`);

    // Create test tasks first
    const createdIds: string[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const task = await this.prisma.task.create({
          data: {
            title: `Performance Test Task for Deletion ${i}`,
            status: "TODO",
            priority: "MEDIUM",
            projectId: "test-project-id",
          createdById: "test-user-id",
          },
        });
        createdIds.push(task.id);
      } catch  {
        console.error("Failed to create test task for deletion operations");
      }
    }

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;

    for (const id of createdIds) {
      const opStart = performance.now();
      try {
        await this.prisma.task.delete({ where: { id } });
        this.recordLatency(performance.now() - opStart);
      } catch  {
        errors++;
        this.recordLatency(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(count / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Delete Operations",
      success: errors === 0,
      duration,
      operations: count,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: count / (duration / 1000),
      errors,
    };
  }

  async testConnectionPoolBehavior(
    concurrentConnections: number = 50,
  ): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Connection Pool Behavior");
    console.log(`   Concurrent Connections: ${concurrentConnections}`);

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;

    const promises = Array.from(
      { length: concurrentConnections },
      async () => {
        const opStart = performance.now();
        try {
          await this.prismaRead.$queryRaw`SELECT 1`;
          this.recordLatency(performance.now() - opStart);
        } catch  {
          errors++;
          this.recordLatency(performance.now() - opStart);
        }
      },
    );

    await Promise.all(promises);

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(concurrentConnections / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Connection Pool Behavior",
      success: errors === 0,
      duration,
      operations: concurrentConnections,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: concurrentConnections / (duration / 1000),
      errors,
    };
  }

  async testAggregationQueries(count: number = 100): Promise<DbTestResult> {
    console.log("\n🔍 Testing: Aggregation Queries");
    console.log(`   Operations: ${count}`);

    this.resetLatencies();
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < count; i++) {
      const opStart = performance.now();
      try {
        // Aggregation query
        await this.prismaRead.task.groupBy({
          by: ["status"],
          _count: {
            id: true,
          },
        });
        this.recordLatency(performance.now() - opStart);
      } catch  {
        errors++;
        this.recordLatency(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const metrics = this.calculateLatencyMetrics();

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(
      `   Throughput: ${(count / (duration / 1000)).toFixed(2)} ops/s`,
    );
    console.log(`   Errors: ${errors}`);

    return {
      name: "Aggregation Queries",
      success: errors === 0,
      duration,
      operations: count,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      minLatency: metrics.min,
      maxLatency: metrics.max,
      throughput: count / (duration / 1000),
      errors,
    };
  }

  async runDatabaseSuite() {
    console.log("🚀 Starting Database Performance Test Suite");
    console.log("=".repeat(60));

    const results: DbTestResult[] = [];
    const startTime = performance.now();

    try {
      // Test simple reads
      results.push(await this.testSimpleReadOperations(1000));
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test complex reads
      results.push(await this.testComplexReadOperations(500));
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test writes
      results.push(await this.testWriteOperations(200));
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test updates
      results.push(await this.testUpdateOperations(300));
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test deletes
      results.push(await this.testDeleteOperations(100));
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test connection pool
      results.push(await this.testConnectionPoolBehavior(50));
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test aggregations
      results.push(await this.testAggregationQueries(100));
    } catch (error) {
      console.error("Database test suite failed:", error);
    } finally {
      await this.cleanup();
    }

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    this.printSummary(results, totalDuration);

    return results;
  }

  private printSummary(results: DbTestResult[], totalDuration: number) {
    console.log("\n" + "=".repeat(60));
    console.log("📊 DATABASE PERFORMANCE TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${results.filter((r) => r.success).length} ✅`);
    console.log(`Failed: ${results.filter((r) => !r.success).length} ❌`);

    console.log("\n📈 Detailed Results:");
    results.forEach((result) => {
      console.log(`\n${result.name}:`);
      console.log(`  Throughput: ${result.throughput.toFixed(2)} ops/s`);
      console.log(`  Avg Latency: ${result.averageLatency.toFixed(2)}ms`);
      console.log(`  P95 Latency: ${result.p95Latency.toFixed(2)}ms`);
      console.log(`  P99 Latency: ${result.p99Latency.toFixed(2)}ms`);
      console.log(`  Errors: ${result.errors}`);
      console.log(`  Status: ${result.success ? "✅ PASSED" : "❌ FAILED"}`);
    });

    console.log("=".repeat(60));
  }
}

// Run tests if executed directly
const isMainModule =
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  const tester = new DatabasePerformanceTester();

  tester
    .runDatabaseSuite()
    .then(() => {
      console.log("\n✅ Database performance tests completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Database performance tests failed:", error);
      process.exit(1);
    });
}

export { DatabasePerformanceTester };
