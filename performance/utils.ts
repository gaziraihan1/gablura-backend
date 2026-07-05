/**
 * Performance Test Utilities
 * 
 * Helper functions for running performance tests, collecting metrics,
 * and generating reports.
 */

import autocannon from 'autocannon';
import type { TestScenario, PerformanceThresholds } from './config.js';

export interface TestResult {
  scenario: string;
  success: boolean;
  duration: number;
  requests: {
    total: number;
    successful: number;
    failed: number;
    average: number;
    p50: number;
    p95: number;
    p99: number;
  };
  throughput: {
    average: number;
    min: number;
    max: number;
  };
  errors: {
    rate: number;
    codes: Record<number, number> | number;
  };
  latency: {
    average: number;
    min: number;
    max: number;
  };
  passedThresholds: boolean;
  thresholdViolations: string[];
}

export interface PerformanceReport {
  timestamp: string;
  testDuration: number;
  results: TestResult[];
  summary: {
    totalScenarios: number;
    passedScenarios: number;
    failedScenarios: number;
    overallSuccessRate: number;
  };
}

/**
 * Run a single performance test scenario using autocannon
 */
export async function runScenario(
  scenario: TestScenario,
  serverUrl: string
): Promise<TestResult> {
  const url = `${serverUrl}${scenario.endpoint}`;
  
  const options: any = {
    url,
    method: scenario.method,
    connections: scenario.load.connections,
    amount: scenario.load.amount,
    pipelining: scenario.load.pipelining || 1,
    timeout: scenario.load.timeout || 10000,
    headers: {
      ...scenario.headers,
      ...(scenario.auth?.token ? { 
        'Authorization': `Bearer ${scenario.auth.token}` 
      } : {}),
    },
  };

  // Only add duration if it's defined and amount is not set
  if (scenario.load.duration && !scenario.load.amount) {
    options.duration = scenario.load.duration;
  }

  if (scenario.body) {
    options.body = JSON.stringify(scenario.body);
  }

  console.log(`\n🚀 Running scenario: ${scenario.name}`);
  console.log(`   URL: ${url}`);
  console.log(`   Method: ${scenario.method}`);
  console.log(`   Connections: ${scenario.load.connections}`);
  console.log(`   Amount: ${scenario.load.amount}`);
  if (scenario.load.duration && !scenario.load.amount) {
    console.log(`   Duration: ${scenario.load.duration}s`);
  }

  const result = await autocannon(options);
  const p95 =
        (result.latency as any).p95 ??
        (result.latency as any).percentiles?.[95] ??
        (result.latency as any)["95"] ??
        0;
  
  return {
    scenario: scenario.name,
    success: result.errors === 0,
    duration: result.duration,
    requests: {
      total: result.requests.total,
      successful: result.requests.total - result.errors,
      failed: result.errors,
      average: result.latency.mean,
      p50: result.latency.p50,
      p95: p95,
      p99: result.latency.p99,
    },
    throughput: {
      average: result.requests.total / result.duration,
      min: result.throughput.min || 0,
      max: result.throughput.max || 0,
    },
    errors: {
      rate: (result.errors / result.requests.total) * 100,
      codes: result.non2xx,
    },
    latency: {
      average: result.latency.mean,
      min: result.latency.min,
      max: result.latency.max,
    },
    passedThresholds: true, // Will be calculated by validateThresholds
    thresholdViolations: [],
  };
}

/**
 * Validate test results against performance thresholds
 */
export function validateThresholds(
  result: TestResult,
  thresholds: PerformanceThresholds
): TestResult {
  const violations: string[] = [];

  // Check response time thresholds
  if (result.requests.p50 > thresholds.responseTime.p50) {
    violations.push(`P50 response time ${result.requests.p50}ms exceeds threshold ${thresholds.responseTime.p50}ms`);
  }
  if (result.requests.p95 > thresholds.responseTime.p95) {
    violations.push(`P95 response time ${result.requests.p95}ms exceeds threshold ${thresholds.responseTime.p95}ms`);
  }
  if (result.requests.p99 > thresholds.responseTime.p99) {
    violations.push(`P99 response time ${result.requests.p99}ms exceeds threshold ${thresholds.responseTime.p99}ms`);
  }
  if (result.requests.average > thresholds.responseTime.max) {
    violations.push(`Max response time ${result.requests.average}ms exceeds threshold ${thresholds.responseTime.max}ms`);
  }

  // Check throughput thresholds
  if (result.throughput.average < thresholds.throughput.min) {
    violations.push(`Throughput ${result.throughput.average} RPS below minimum ${thresholds.throughput.min} RPS`);
  }

  // Check error rate threshold
  if (result.errors.rate > thresholds.errorRate.max) {
    violations.push(`Error rate ${result.errors.rate}% exceeds maximum ${thresholds.errorRate.max}%`);
  }

  // Check database-specific thresholds if applicable
  if (thresholds.database) {
    if (result.latency.average > thresholds.database.queryLatency.p50) {
      violations.push(`Database query latency ${result.latency.average}ms exceeds P50 threshold ${thresholds.database.queryLatency.p50}ms`);
    }
  }

  result.passedThresholds = violations.length === 0;
  result.thresholdViolations = violations;

  return result;
}

/**
 * Generate a performance report from test results
 */
export function generateReport(results: TestResult[]): PerformanceReport {
  const passedScenarios = results.filter(r => r.passedThresholds).length;
  const totalSuccessfulRequests = results.reduce((sum, r) => sum + r.requests.successful, 0);
  const totalRequests = results.reduce((sum, r) => sum + r.requests.total, 0);

  return {
    timestamp: new Date().toISOString(),
    testDuration: results.reduce((sum, r) => sum + r.duration, 0),
    results,
    summary: {
      totalScenarios: results.length,
      passedScenarios,
      failedScenarios: results.length - passedScenarios,
      overallSuccessRate: (totalSuccessfulRequests / totalRequests) * 100,
    },
  };
}

/**
 * Print test results to console
 */
export function printResults(result: TestResult): void {
  console.log(`\n📊 Results for: ${result.scenario}`);
  console.log('─'.repeat(50));
  console.log(`Status: ${result.passedThresholds ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Duration: ${result.duration ? result.duration.toFixed(2) : '0.00'}s`);
  console.log(`\nRequests:`);
  console.log(`  Total: ${result.requests.total}`);
  console.log(`  Successful: ${result.requests.successful}`);
  console.log(`  Failed: ${result.requests.failed}`);
  console.log(`\nResponse Times:`);
  console.log(`  Average: ${result.requests.average ? result.requests.average.toFixed(2) : '0.00'}ms`);
  console.log(`  P50: ${result.requests.p50 ? result.requests.p50.toFixed(2) : '0.00'}ms`);
  console.log(`  P95: ${result.requests.p95 ? result.requests.p95.toFixed(2) : '0.00'}ms`);
  console.log(`  P99: ${result.requests.p99 ? result.requests.p99.toFixed(2) : '0.00'}ms`);
  console.log(`\nThroughput:`);
  console.log(`  Average: ${result.throughput.average ? result.throughput.average.toFixed(2) : '0.00'} req/s`);
  console.log(`  Min: ${result.throughput.min ? result.throughput.min.toFixed(2) : '0.00'} req/s`);
  console.log(`  Max: ${result.throughput.max ? result.throughput.max.toFixed(2) : '0.00'} req/s`);
  console.log(`\nErrors:`);
  console.log(`  Rate: ${result.errors.rate ? result.errors.rate.toFixed(2) : '0.00'}%`);
  console.log(`  Codes: ${JSON.stringify(result.errors.codes)}`);

  if (result.thresholdViolations.length > 0) {
    console.log(`\n⚠️  Threshold Violations:`);
    result.thresholdViolations.forEach(violation => {
      console.log(`  - ${violation}`);
    });
  }
}

/**
 * Print summary report
 */
export function printSummaryReport(report: PerformanceReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('📈 PERFORMANCE TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total Test Duration: ${report.testDuration.toFixed(2)}s`);
  console.log(`\nScenarios: ${report.summary.totalScenarios}`);
  console.log(`Passed: ${report.summary.passedScenarios} ✅`);
  console.log(`Failed: ${report.summary.failedScenarios} ❌`);
  console.log(`Overall Success Rate: ${report.summary.overallSuccessRate.toFixed(2)}%`);
  console.log('='.repeat(60));

  if (report.summary.failedScenarios > 0) {
    console.log('\n⚠️  Failed Scenarios:');
    report.results
      .filter(r => !r.passedThresholds)
      .forEach(r => {
        console.log(`  - ${r.scenario}`);
        r.thresholdViolations.forEach(v => {
          console.log(`    • ${v}`);
        });
      });
  }
}

/**
 * Save report to JSON file
 */
export async function saveReportToFile(
  report: PerformanceReport,
  outputDir: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const filename = `performance-report-${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Report saved to: ${filepath}`);
  } catch (error) {
    console.error('Failed to save report:', error);
  }
}

/**
 * Warm up the server before running performance tests
 */
export async function warmUpServer(serverUrl: string): Promise<void> {
  console.log('\n🔥 Warming up server...');
  const warmUpOptions: any = {
    url: `${serverUrl}/health`,
    connections: 2,
    amount: 10,
    timeout: 5000,
  };
  
  try {
    await autocannon(warmUpOptions);
    console.log('✅ Server warm-up complete');
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      console.error('❌ Server is not running or not accessible');
      console.error(`   Make sure the server is running at ${serverUrl}`);
      console.error('   Start the server with: npm run dev');
      throw new Error('Server not accessible. Please start the server first.', { cause: error });
    }
    console.warn('⚠️  Server warm-up failed, continuing with tests:', error.message);
  }
}
