/**
 * Load Testing Scripts
 * 
 * Specialized load testing scenarios for stress testing and capacity planning.
 * Tests the system under various load patterns: baseline, peak, stress, and spike.
 */

import autocannon from 'autocannon';
import { performance } from 'perf_hooks';

interface LoadTestConfig {
  name: string;
  endpoint: string;
  method: string;
  loadProfile: 'baseline' | 'peak' | 'stress' | 'spike';
  amount?: number;
  duration?: number;
  connections?: number;
  rate?: number;
}

class LoadTester {
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

  private getLoadProfile(profile: 'baseline' | 'peak' | 'stress' | 'spike') {
    const profiles = {
      baseline: {
        connections: 10,
        amount: 1000,
        rate: 10,
      },
      peak: {
        connections: 50,
        amount: 5000,
        rate: 50,
      },
      stress: {
        connections: 100,
        amount: 10000,
        rate: 100,
      },
      spike: {
        connections: 200,
        amount: 2000,
        rate: 200,
      },
    };

    return profiles[profile];
  }

  async runLoadTest(config: LoadTestConfig) {
    const profile = this.getLoadProfile(config.loadProfile);
    const url = `${this.baseUrl}${config.endpoint}`;

    console.log(`\n🔥 Running ${config.loadProfile} load test: ${config.name}`);
    console.log(`   URL: ${url}`);
    console.log(`   Method: ${config.method}`);
    console.log(`   Connections: ${config.connections || profile.connections}`);
    console.log(`   Amount: ${config.amount || profile.amount}`);
    console.log(`   Rate: ${config.rate || profile.rate} req/s`);

    const options: any = {
      url,
      method: config.method,
      connections: config.connections || profile.connections,
      connectionRate: config.rate || profile.rate,
      headers: this.getHeaders(),
      timeout: 60000,
      maxConnectionRequests: 1000,
    };

    // Use amount if specified, otherwise use duration
    if (config.amount) {
      options.amount = config.amount;
    } else if (profile.amount) {
      options.amount = profile.amount;
    }

    if (config.duration) {
      options.duration = config.duration;
    }

    const startTime = performance.now();

    try {
      const result = await autocannon(options);
      const endTime = performance.now();
      const testDuration = endTime - startTime;

      console.log(`\n📊 Load Test Results:`);
      console.log(`   Test Duration: ${(testDuration / 1000).toFixed(2)}s`);
      console.log(`   Total Requests: ${result.requests.total}`);
      console.log(`   Successful: ${result.requests.total - result.errors}`);
      console.log(`   Failed: ${result.errors}`);
      console.log(`   Throughput: ${result.throughput.mean.toFixed(2)} req/s`);
      console.log(`   Latency (avg): ${result.latency.mean.toFixed(2)}ms`);
      console.log(`   Latency (p50): ${(result.latency as any).p50.toFixed(2)}ms`);
      console.log(`   Latency (p95): ${(result.latency as any).p95.toFixed(2)}ms`);
      console.log(`   Latency (p99): ${(result.latency as any).p99.toFixed(2)}ms`);
      console.log(`   Latency (min): ${result.latency.min.toFixed(2)}ms`);
      console.log(`   Latency (max): ${result.latency.max.toFixed(2)}ms`);
      console.log(`   Error Rate: ${((result.errors / result.requests.total) * 100).toFixed(2)}%`);

      return {
        name: config.name,
        loadProfile: config.loadProfile,
        success: result.errors === 0,
        duration: testDuration,
        result,
      };
    } catch (error) {
      console.error('Load test failed:', error);
      throw error;
    }
  }

  async runComprehensiveLoadTest(endpoint: string) {
    console.log('🚀 Starting Comprehensive Load Test Suite');
    console.log('='.repeat(60));
    console.log(`Target Endpoint: ${endpoint}`);
    console.log('='.repeat(60));

    const results = [];

    // Baseline test
    results.push(await this.runLoadTest({
      name: 'Baseline Load Test',
      endpoint,
      method: 'GET',
      loadProfile: 'baseline',
    }));

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Peak load test
    results.push(await this.runLoadTest({
      name: 'Peak Load Test',
      endpoint,
      method: 'GET',
      loadProfile: 'peak',
    }));

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Stress test
    results.push(await this.runLoadTest({
      name: 'Stress Test',
      endpoint,
      method: 'GET',
      loadProfile: 'stress',
    }));

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Spike test
    results.push(await this.runLoadTest({
      name: 'Spike Test',
      endpoint,
      method: 'GET',
      loadProfile: 'spike',
    }));

    this.printLoadTestSummary(results);

    return results;
  }

  async runCriticalEndpointsLoadTest() {
    console.log('🚀 Starting Critical Endpoints Load Test Suite');
    console.log('='.repeat(60));

    const criticalEndpoints = [
      { name: 'Health Check', endpoint: '/health', method: 'GET' },
      { name: 'Get Workspaces', endpoint: '/api/v1/workspaces', method: 'GET' },
      { name: 'Get Tasks', endpoint: '/api/v1/tasks', method: 'GET' },
      { name: 'Get Activities', endpoint: '/api/v1/activities', method: 'GET' },
      { name: 'Task Statistics', endpoint: '/api/v1/tasks/stats', method: 'GET' },
    ];

    const results = [];

    for (const endpoint of criticalEndpoints) {
      console.log(`\n🎯 Testing: ${endpoint.name}`);
      
      // Run peak load test for each critical endpoint
      const result = await this.runLoadTest({
        name: `${endpoint.name} - Peak Load`,
        endpoint: endpoint.endpoint,
        method: endpoint.method,
        loadProfile: 'peak',
      });

      results.push(result);

      // Cooldown between tests
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    this.printCriticalEndpointsSummary(results);

    return results;
  }

  private printLoadTestSummary(results: any[]) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 COMPREHENSIVE LOAD TEST SUMMARY');
    console.log('='.repeat(60));

    results.forEach(result => {
      console.log(`\n${result.name} (${result.loadProfile}):`);
      console.log(`  Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`  Throughput: ${result.result.throughput.mean.toFixed(2)} req/s`);
      console.log(`  P95 Latency: ${(result.result.latency as any).p95.toFixed(2)}ms`);
      console.log(`  P99 Latency: ${(result.result.latency as any).p99.toFixed(2)}ms`);
      console.log(`  Error Rate: ${((result.result.errors / result.result.requests.total) * 100).toFixed(2)}%`);
    });

    console.log('='.repeat(60));
  }

  private printCriticalEndpointsSummary(results: any[]) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 CRITICAL ENDPOINTS LOAD TEST SUMMARY');
    console.log('='.repeat(60));

    results.forEach(result => {
      console.log(`\n${result.name}:`);
      console.log(`  Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`  Throughput: ${result.result.throughput.mean.toFixed(2)} req/s`);
      console.log(`  P95 Latency: ${(result.result.latency as any).p95.toFixed(2)}ms`);
      console.log(`  P99 Latency: ${(result.result.latency as any).p99.toFixed(2)}ms`);
      console.log(`  Error Rate: ${((result.result.errors / result.result.requests.total) * 100).toFixed(2)}%`);
    });

    const passedCount = results.filter(r => r.success).length;
    console.log(`\nOverall: ${passedCount}/${results.length} endpoints passed peak load test`);

    console.log('='.repeat(60));
  }
}

// Run tests if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  const tester = new LoadTester();
  
  // Optionally set auth token if provided
  if (process.env.AUTH_TOKEN) {
    tester.setAuthToken(process.env.AUTH_TOKEN);
  }

  const endpoint = process.argv[2] || '/health';
  const testType = process.argv[3] || 'comprehensive';

  if (testType === 'comprehensive') {
    tester.runComprehensiveLoadTest(endpoint)
      .then(() => {
        console.log('\n✅ Comprehensive load tests completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Comprehensive load tests failed:', error);
        process.exit(1);
      });
  } else if (testType === 'critical') {
    tester.runCriticalEndpointsLoadTest()
      .then(() => {
        console.log('\n✅ Critical endpoints load tests completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Critical endpoints load tests failed:', error);
        process.exit(1);
      });
  } else {
    console.error('Invalid test type. Use "comprehensive" or "critical"');
    process.exit(1);
  }
}

export { LoadTester };
