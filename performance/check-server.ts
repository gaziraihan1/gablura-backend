/**
 * Server Health Check
 * 
 * Checks if the server is running and accessible before running performance tests.
 */

import http from 'http';

async function checkServer(url: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const options = {
      hostname: url.replace('http://', '').replace('https://', '').split(':')[0],
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function main() {
  const serverUrl = process.env.TEST_SERVER_URL || 'http://localhost:5000';
  const port = parseInt(process.env.TEST_SERVER_PORT || '5000');
  const hostname = serverUrl.replace('http://', '').replace('https://', '').split(':')[0];

  console.log('🔍 Checking server availability...');
  console.log(`   URL: ${serverUrl}`);
  console.log(`   Host: ${hostname}`);
  console.log(`   Port: ${port}`);

  const isRunning = await checkServer(hostname, port);

  if (isRunning) {
    console.log('✅ Server is running and accessible');
    console.log('\nYou can now run performance tests:');
    console.log('  npm run test:performance');
    console.log('  npm run test:performance:api');
    console.log('  npm run test:performance:database');
    console.log('  npm run test:performance:service');
    console.log('  npm run test:performance:load');
    process.exit(0);
  } else {
    console.log('❌ Server is not running or not accessible');
    console.log('\nPlease start the server first:');
    console.log('  npm run dev          # For development');
    console.log('  npm run build && npm start  # For production');
    console.log('\nOr specify a different server URL:');
    console.log('  TEST_SERVER_URL=http://your-server:port npm run test:performance');
    process.exit(1);
  }
}

main().catch(console.error);
