/**
 * Simple API Performance Tests
 * 
 * Focused on public endpoints that don't require authentication
 * to ensure tests work reliably without complex setup.
 */

import autocannon from 'autocannon';
import { performance } from 'perf_hooks';

interface SimpleTestConfig {
  name: string;
  endpoint: string;
  method: string;
  body?: any;
  connections: number;
  amount: number;
}

class SimpleApiPerformanceTester {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
  }

  async runTest(config: SimpleTestConfig): Promise<any> {
    const url = `${this.baseUrl}${config.endpoint}`;
    const startTime = performance.now();

    console.log(`\n🔍 Testing: ${config.name}`);
    console.log(`   URL: ${url}`);
    console.log(`   Method: ${config.method}`);
    console.log(`   Connections: ${config.connections}`);
    console.log(`   Amount: ${config.amount}`);

    const options: any = {
      url,
      method: config.method,
      connections: config.connections,
      amount: config.amount,
      headers: {
        'Content-Type': 'application/json',
      },
      body: config.body ? JSON.stringify(config.body) : undefined,
      timeout: 30000,
    };

    try {
      const result = await autocannon(options);
      const endTime = performance.now();
      const testDuration = endTime - startTime;
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

      console.log(`\n✅ Test completed in ${(testDuration / 1000).toFixed(2)}s`);
      console.log(`   Requests/sec: ${result.throughput.mean.toFixed(2)}`);
      console.log(`   Latency (avg): ${result.latency.mean.toFixed(2)}ms`);
      console.log(`   Latency (p95): ${p95.toFixed(2)}ms`);
      console.log(`   Latency (p99): ${p99.toFixed(2)}ms`);
      console.log(`   Errors: ${result.errors} (${result.requests.total > 0 ? ((result.errors / result.requests.total) * 100).toFixed(2) : '100.00'}%)`);

      return {
        name: config.name,
        success: result.errors === 0,
        duration: testDuration,
        result,
      };
    } catch (error: any) {
      console.error(`❌ Test failed:`, error.message);
      return {
        name: config.name,
        success: false,
        error: error.message,
      };
    }
  }

  async runSimpleApiSuite() {
    console.log('🚀 Starting Simple API Performance Test Suite');
    console.log('='.repeat(60));

    const tests: SimpleTestConfig[] = [
      // Health Check - Always available
      {
        name: 'Health Check',
        endpoint: '/health',
        method: 'GET',
        connections: 10,
        amount: 1000,
      },

      // Public Endpoints - No auth required
      {
        name: 'Contact Form',
        endpoint: '/api/v1/contact',
        method: 'POST',
        connections: 10,
        amount: 200,
        body: {
          name: 'Performance Test',
          email: 'test@example.com',
          message: 'Performance test message',
        },
      },

      {
        name: 'Job Listings',
        endpoint: '/api/v1/jobs',
        method: 'GET',
        connections: 15,
        amount: 300,
      },

      {
        name: 'Templates',
        endpoint: '/api/v1/templates',
        method: 'GET',
        connections: 15,
        amount: 300,
      },
    ];

    const results = [];
    const startTime = performance.now();

    for (const test of tests) {
      try {
        const result = await this.runTest(test);
        results.push(result);
        
        // Add delay between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
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
    console.log('\n' + '='.repeat(60));
    console.log('📊 SIMPLE API PERFORMANCE TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${results.filter(r => r.success).length} ✅`);
    console.log(`Failed: ${results.filter(r => !r.success).length} ❌`);

    if (results.some(r => !r.success)) {
      console.log('\n❌ Failed Tests:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.name}: ${r.error || 'Unknown error'}`);
      });
    }

    console.log('='.repeat(60));
  }
}

// Run tests if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  const tester = new SimpleApiPerformanceTester();
  
  tester.runSimpleApiSuite()
    .then(() => {
      console.log('\n✅ Simple API performance tests completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Simple API performance tests failed:', error);
      process.exit(1);
    });
}

export { SimpleApiPerformanceTester };
