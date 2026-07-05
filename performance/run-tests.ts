/**
 * Main Performance Test Runner
 * 
 * Orchestrates the execution of all performance test scenarios,
 * validates results against thresholds, and generates reports.
 */

import { defaultConfig } from './config.js';
import {
  runScenario,
  validateThresholds,
  generateReport,
  printResults,
  printSummaryReport,
  saveReportToFile,
  warmUpServer,
} from './utils.js';

async function main() {
  console.log('🚀 Starting Focura Backend Performance Tests');
  console.log('='.repeat(60));
  console.log(`Server URL: ${defaultConfig.server.url}`);
  console.log(`Total Scenarios: ${defaultConfig.scenarios.length}`);
  console.log('='.repeat(60));

  // Warm up the server
  try {
    await warmUpServer(defaultConfig.server.url);
  } catch (error: any) {
    console.error('\n❌ Cannot proceed with performance tests - server is not accessible');
    console.error('\nPlease start the server first:');
    console.error('  npm run dev          # For development');
    console.error('  npm run build && npm start  # For production');
    console.error('\nOr specify a different server URL:');
    console.error('  TEST_SERVER_URL=http://your-server:port npm run test:performance');
    process.exit(1);
  }

  const results = [];

  // Run each scenario
  for (const scenario of defaultConfig.scenarios) {
    try {
      const result = await runScenario(scenario, defaultConfig.server.url);
      const validatedResult = validateThresholds(result, defaultConfig.thresholds);
      printResults(validatedResult);
      results.push(validatedResult);
    } catch (error: any) {
      console.error(`❌ Error running scenario ${scenario.name}:`, error.message);
      
      // Check if it's a connection error
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        console.error('\n❌ Server connection lost during testing');
        console.error('   The server may have stopped or become unreachable');
        console.error('   Please check the server status and try again');
        break;
      }
      
      results.push({
        scenario: scenario.name,
        success: false,
        duration: 0,
        requests: {
          total: 0,
          successful: 0,
          failed: 0,
          average: 0,
          p50: 0,
          p95: 0,
          p99: 0,
        },
        throughput: {
          average: 0,
          min: 0,
          max: 0,
        },
        errors: {
          rate: 100,
          codes: {},
        },
        latency: {
          average: 0,
          min: 0,
          max: 0,
        },
        passedThresholds: false,
        thresholdViolations: ['Test execution failed'],
      });
    }

    // Add a small delay between scenarios
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Generate and print summary report
  const report = generateReport(results);
  printSummaryReport(report);

  // Save report to file
  await saveReportToFile(report, defaultConfig.reporting.outputDir);

  // Exit with appropriate code
  const exitCode = report.summary.failedScenarios > 0 ? 1 : 0;
  process.exit(exitCode);
}

// Run the tests
main().catch(error => {
  console.error('Fatal error in performance test runner:', error);
  process.exit(1);
});
