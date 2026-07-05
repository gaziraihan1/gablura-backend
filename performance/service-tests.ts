/**
 * Service Layer Performance Tests
 * 
 * Focused performance tests for service layer operations.
 * Tests business logic, data transformations, and complex service operations.
 */

import { performance } from 'perf_hooks';
import autocannon from 'autocannon';

interface ServiceTestResult {
  name: string;
  success: boolean;
  duration: number;
  operations: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  errors: number;
  memoryUsage?: {
    before: number;
    after: number;
    delta: number;
  };
}

class ServicePerformanceTester {
  private baseUrl: string;
  private authToken?: string;

  constructor(baseUrl: string = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
  }

  setAuthToken(token: string) {
    this.authToken = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }


  private getMemoryUsage(): number {
    return process.memoryUsage().heapUsed / 1024 / 1024; // MB
  }

  async testTaskStatisticsService(iterations: number = 100): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Task Statistics Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/tasks/stats`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 10000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch  {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Task Statistics Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  async testWorkspaceOverviewService(iterations: number = 50): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Workspace Overview Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/workspaces/test-slug/overview`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 15000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch  {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Workspace Overview Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  async testActivityTrendsService(iterations: number = 50): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Activity Trends Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/analytics/test-workspace-id/activity/trends`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 15000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch  {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Activity Trends Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  async testCalendarAggregationService(iterations: number = 75): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Calendar Aggregation Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/calendar/aggregates`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 10000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch  {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Calendar Aggregation Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  async testMemberContributionService(iterations: number = 50): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Member Contribution Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/analytics/test-workspace-id/members/contribution`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 15000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch  {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Member Contribution Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  async testProjectHealthService(iterations: number = 50): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Project Health Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/analytics/test-workspace-id/projects/health`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 15000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch  {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Project Health Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  async testTimeSummaryService(iterations: number = 50): Promise<ServiceTestResult> {
    console.log('\n🔍 Testing: Time Summary Service');
    console.log(`   Iterations: ${iterations}`);

    const memBefore = this.getMemoryUsage();
    const latencies: number[] = [];
    const startTime = performance.now();
    let errors = 0;

    for (let i = 0; i < iterations; i++) {
      const opStart = performance.now();
      try {
        const result = await autocannon({
          url: `${this.baseUrl}/api/v1/analytics/test-workspace-id/time/summary`,
          method: 'GET',
          connections: 1,
          amount: 1,
          headers: this.getHeaders(),
          timeout: 15000,
        });
        
        latencies.push(result.latency.mean);
        if (result.errors > 0) errors++;
      } catch {
        errors++;
        latencies.push(performance.now() - opStart);
      }
    }

    const duration = performance.now() - startTime;
    const memAfter = this.getMemoryUsage();
    const metrics = this.calculateLatencyMetrics(latencies);

    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   Average Latency: ${metrics.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95.toFixed(2)}ms`);
    console.log(`   Throughput: ${(iterations / (duration / 1000)).toFixed(2)} ops/s`);
    console.log(`   Memory Delta: ${(memAfter - memBefore).toFixed(2)}MB`);
    console.log(`   Errors: ${errors}`);

    return {
      name: 'Time Summary Service',
      success: errors === 0,
      duration,
      operations: iterations,
      averageLatency: metrics.average,
      p50Latency: metrics.p50,
      p95Latency: metrics.p95,
      p99Latency: metrics.p99,
      throughput: iterations / (duration / 1000),
      errors,
      memoryUsage: {
        before: memBefore,
        after: memAfter,
        delta: memAfter - memBefore,
      },
    };
  }

  private calculateLatencyMetrics(latencies: number[]) {
    if (latencies.length === 0) {
      return { average: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    return {
      average: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  async runServiceSuite() {
    console.log('🚀 Starting Service Layer Performance Test Suite');
    console.log('='.repeat(60));

    const results: ServiceTestResult[] = [];
    const startTime = performance.now();

    try {
      // Test task statistics service
      results.push(await this.testTaskStatisticsService(100));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test workspace overview service
      results.push(await this.testWorkspaceOverviewService(50));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test activity trends service
      results.push(await this.testActivityTrendsService(50));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test calendar aggregation service
      results.push(await this.testCalendarAggregationService(75));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test member contribution service
      results.push(await this.testMemberContributionService(50));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test project health service
      results.push(await this.testProjectHealthService(50));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test time summary service
      results.push(await this.testTimeSummaryService(50));

    } catch (error) {
      console.error('Service test suite failed:', error);
    }

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    this.printSummary(results, totalDuration);

    return results;
  }

  private printSummary(results: ServiceTestResult[], totalDuration: number) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SERVICE LAYER PERFORMANCE TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${results.filter(r => r.success).length} ✅`);
    console.log(`Failed: ${results.filter(r => !r.success).length} ❌`);

    console.log('\n📈 Detailed Results:');
    results.forEach(result => {
      console.log(`\n${result.name}:`);
      console.log(`  Throughput: ${result.throughput.toFixed(2)} ops/s`);
      console.log(`  Avg Latency: ${result.averageLatency.toFixed(2)}ms`);
      console.log(`  P95 Latency: ${result.p95Latency.toFixed(2)}ms`);
      console.log(`  P99 Latency: ${result.p99Latency.toFixed(2)}ms`);
      console.log(`  Errors: ${result.errors}`);
      if (result.memoryUsage) {
        console.log(`  Memory Delta: ${result.memoryUsage.delta.toFixed(2)}MB`);
      }
      console.log(`  Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    });

    // Memory usage summary
    const memoryDeltas = results
      .filter(r => r.memoryUsage)
      .map(r => r.memoryUsage!.delta);
    
    if (memoryDeltas.length > 0) {
      const totalMemoryDelta = memoryDeltas.reduce((sum, delta) => sum + delta, 0);
      console.log(`\n💾 Total Memory Usage: ${totalMemoryDelta.toFixed(2)}MB`);
    }

    console.log('='.repeat(60));
  }
}

// Run tests if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  const tester = new ServicePerformanceTester();
  
  // Optionally set auth token if provided
  if (process.env.AUTH_TOKEN) {
    tester.setAuthToken(process.env.AUTH_TOKEN);
  }

  tester.runServiceSuite()
    .then(() => {
      console.log('\n✅ Service layer performance tests completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Service layer performance tests failed:', error);
      process.exit(1);
    });
}

export { ServicePerformanceTester };
