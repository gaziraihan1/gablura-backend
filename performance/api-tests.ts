/**
 * API Performance Tests
 *
 * Focused performance tests for REST API endpoints.
 * Tests various endpoints under different load conditions.
 */

import autocannon from "autocannon";
import { performance } from "perf_hooks";

interface ApiTestConfig {
  name: string;
  endpoint: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
  connections: number;
  amount: number;
  duration?: number;
}

class ApiPerformanceTester {
  private baseUrl: string;
  private authToken?: string;

  constructor(baseUrl: string = "http://localhost:5000") {
    this.baseUrl = baseUrl;
  }

  setAuthToken(token: string) {
    this.authToken = token;
  }

  private getHeaders(
    incomingHeaders: Record<string, string> | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {
      "Content-Type": "application/json",
      ...(incomingHeaders || {}),
    };

    if (this.authToken) {
      result["Authorization"] = `Bearer ${this.authToken}`;
    }

    return result;
  }

  async runTest(config: ApiTestConfig): Promise<any> {
    const url = `${this.baseUrl}${config.endpoint}`;
    const startTime = performance.now();

    console.log(`\n🔍 Testing: ${config.name}`);
    console.log(`   URL: ${url}`);
    console.log(`   Method: ${config.method}`);
    console.log(`   Connections: ${config.connections}`);
    console.log(`   Amount: ${config.amount}`);

    const options = {
      url,
      // autocannon's Options.method expects a specific HTTP method union type;
      // cast here to satisfy TypeScript when method comes from a string config.
      method: config.method as any,
      connections: config.connections,
      amount: config.amount,
      duration: config.duration,
      headers: this.getHeaders(config.headers),
      body: config.body ? JSON.stringify(config.body) : undefined,
      timeout: 30000,
      maxOverallRequests: config.amount,
    };

    try {
      const result = await autocannon(options);
      const endTime = performance.now();
      const testDuration = endTime - startTime;

      console.log(
        `\n✅ Test completed in ${(testDuration / 1000).toFixed(2)}s`,
      );
      console.log(`   Requests/sec: ${result.throughput.mean.toFixed(2)}`);
      console.log(`   Latency (avg): ${result.latency.mean.toFixed(2)}ms`);
      // Safely resolve p95/p99 from possible locations on the latency object
      const p95 =
        (result.latency as any).p95 ??
        (result.latency as any).percentiles?.[95] ??
        (result.latency as any)["95"] ??
        0;
      const p99 =
        (result.latency as any).p99 ??
        (result.latency as any).percentiles?.[99] ??
        (result.latency as any)["99"] ??
        0;
      console.log(`   Latency (p99): ${p99.toFixed(2)}ms`);
      console.log(`   Latency (p95): ${p95.toFixed(2)}ms`);
      console.log(
        `   Errors: ${result.errors} (${((result.errors / result.requests.total) * 100).toFixed(2)}%)`,
      );

      return {
        name: config.name,
        success: result.errors === 0,
        duration: testDuration,
        result,
      };
    } catch (error) {
      console.error(`❌ Test failed:`, error);
      throw error;
    }
  }

  async runApiSuite() {
    console.log("🚀 Starting API Performance Test Suite");
    console.log("=".repeat(60));

    const tests: ApiTestConfig[] = [
      // Basic Health Check
      {
        name: "Health Check",
        endpoint: "/health",
        method: "GET",
        connections: 10,
        amount: 1000,
      },

      // Workspace Operations
      {
        name: "Get All Workspaces",
        endpoint: "/api/v1/workspaces",
        method: "GET",
        connections: 20,
        amount: 500,
      },

      // Project Operations
      {
        name: "Get Projects by Workspace",
        endpoint: "/api/v1/projects/workspace/test-workspace-id",
        method: "GET",
        connections: 20,
        amount: 500,
      },

      // Task Operations - Read Heavy
      {
        name: "Get Tasks",
        endpoint: "/api/v1/tasks",
        method: "GET",
        connections: 30,
        amount: 1000,
      },

      {
        name: "Get Task Statistics",
        endpoint: "/api/v1/tasks/stats",
        method: "GET",
        connections: 15,
        amount: 400,
      },

      // Task Operations - Write Heavy
      {
        name: "Create Task",
        endpoint: "/api/v1/tasks",
        method: "POST",
        connections: 10,
        amount: 200,
        body: {
          title: "Performance Test Task",
          description: "Task created during API performance testing",
          status: "TODO",
          priority: "MEDIUM",
          projectId: "test-project-id",
        },
      },

      // Activity Feed
      {
        name: "Get Activities",
        endpoint: "/api/v1/activities",
        method: "GET",
        connections: 15,
        amount: 500,
      },

      {
        name: "Get Workspace Activities",
        endpoint: "/api/v1/activities/workspace/test-workspace-id",
        method: "GET",
        connections: 15,
        amount: 500,
      },

      // Analytics Operations
      {
        name: "Get Analytics Overview",
        endpoint: "/api/v1/analytics/test-workspace-id/overview",
        method: "GET",
        connections: 10,
        amount: 300,
      },

      {
        name: "Get Task Trends",
        endpoint: "/api/v1/analytics/test-workspace-id/tasks/trends",
        method: "GET",
        connections: 10,
        amount: 300,
      },

      {
        name: "Get Project Health",
        endpoint: "/api/v1/analytics/test-workspace-id/projects/health",
        method: "GET",
        connections: 10,
        amount: 300,
      },

      // Calendar Operations
      {
        name: "Get Calendar Aggregates",
        endpoint: "/api/v1/calendar/aggregates",
        method: "GET",
        connections: 10,
        amount: 300,
      },

      {
        name: "Get Calendar Insights",
        endpoint: "/api/v1/calendar/insights",
        method: "GET",
        connections: 10,
        amount: 300,
      },

      // User Operations
      {
        name: "Get User Profile",
        endpoint: "/api/v1/user/profile",
        method: "GET",
        connections: 20,
        amount: 500,
      },

      // Storage Operations
      {
        name: "Get Storage Stats",
        endpoint: "/api/v1/storage",
        method: "GET",
        connections: 10,
        amount: 300,
      },

      // Label Operations
      {
        name: "Get Labels",
        endpoint: "/api/v1/labels",
        method: "GET",
        connections: 15,
        amount: 400,
      },
    ];

    const results = [];
    const startTime = performance.now();

    for (const test of tests) {
      try {
        const result = await this.runTest(test);
        results.push(result);

        // Add delay between tests
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to run test: ${test.name}`, error);
        results.push({
          name: test.name,
          success: false,
          error: String(error),
        });
      }
    }

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    this.printSummary(results, totalDuration);

    return results;
  }

  private printSummary(results: any[], totalDuration: number) {
    console.log("\n" + "=".repeat(60));
    console.log("📊 API PERFORMANCE TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${results.filter((r) => r.success).length} ✅`);
    console.log(`Failed: ${results.filter((r) => !r.success).length} ❌`);

    if (results.some((r) => !r.success)) {
      console.log("\n❌ Failed Tests:");
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(`  - ${r.name}`);
        });
    }

    console.log("=".repeat(60));
  }

  async runLoadTest(
    endpoint: string,
    method: string = "GET",
    loadProfile: "baseline" | "peak" | "stress" | "spike" = "baseline",
  ) {
    const loadProfiles = {
      baseline: { connections: 10, amount: 1000, duration: 30 },
      peak: { connections: 50, amount: 5000, duration: 60 },
      stress: { connections: 100, amount: 10000, duration: 120 },
      spike: { connections: 200, amount: 2000, duration: 30 },
    };

    const profile = loadProfiles[loadProfile];

    console.log(`\n🔥 Running ${loadProfile} load test on ${endpoint}`);
    console.log(`   Connections: ${profile.connections}`);
    console.log(`   Amount: ${profile.amount}`);
    console.log(`   Duration: ${profile.duration}s`);

    const options = {
      url: `${this.baseUrl}${endpoint}`,
      // cast to any to satisfy autocannon's method union type in TypeScript
      method: method as any,
      connections: profile.connections,
      amount: profile.amount,
      duration: profile.duration,
      headers: this.getHeaders(undefined),
      timeout: 60000,
    };

    try {
      const result = await autocannon(options);
      const p95 =
        (result.latency as any).p95 ??
        (result.latency as any).percentiles?.[95] ??
        (result.latency as any)["95"] ??
        0;

      console.log(`\n📊 Load Test Results:`);
      console.log(`   Throughput: ${result.throughput.mean.toFixed(2)} req/s`);
      console.log(`   Latency (avg): ${result.latency.mean.toFixed(2)}ms`);
      console.log(`   Latency (p95): ${p95.toFixed(2)}ms`);
      console.log(`   Latency (p99): ${result.latency.p99.toFixed(2)}ms`);
      console.log(
        `   Errors: ${result.errors} (${((result.errors / result.requests.total) * 100).toFixed(2)}%)`,
      );
      console.log(`   Total Requests: ${result.requests.total}`);

      return result;
    } catch (error) {
      console.error("Load test failed:", error);
      throw error;
    }
  }
}

// Run tests if executed directly
const isMainModule =
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  const tester = new ApiPerformanceTester();

  // Optionally set auth token if provided
  if (process.env.AUTH_TOKEN) {
    tester.setAuthToken(process.env.AUTH_TOKEN);
  }

  tester
    .runApiSuite()
    .then(() => {
      console.log("\n✅ API performance tests completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ API performance tests failed:", error);
      process.exit(1);
    });
}

export { ApiPerformanceTester };
