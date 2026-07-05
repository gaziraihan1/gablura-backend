/**
 * Performance Test Configuration
 * 
 * Defines test scenarios, load patterns, and performance thresholds
 * for comprehensive performance testing of the Focura backend.
 */

export interface PerformanceConfig {
  server: {
    url: string;
    port: number;
  };
  scenarios: TestScenario[];
  thresholds: PerformanceThresholds;
  reporting: {
    outputDir: string;
    formats: ('json' | 'html' | 'console')[];
  };
}

export interface TestScenario {
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  auth?: {
    type: 'bearer' | 'basic';
    token?: string;
  };
  load: LoadPattern;
  category: 'api' | 'database' | 'service';
}

export interface LoadPattern {
  // Number of concurrent connections
  connections: number;
  // Total number of requests to send
  amount: number;
  // Duration of the test (overrides amount if set)
  duration?: number;
  // Connection rate (new connections per second)
  rate?: number;
  // Pipelining (number of requests to send per connection)
  pipelining?: number;
  // Timeout for each request in milliseconds
  timeout?: number;
}

export interface PerformanceThresholds {
  // Response time thresholds (in milliseconds)
  responseTime: {
    p50: number;    // 50th percentile
    p95: number;    // 95th percentile
    p99: number;    // 99th percentile
    max: number;    // Maximum acceptable response time
  };
  // Throughput thresholds (requests per second)
  throughput: {
    min: number;    // Minimum acceptable RPS
    target: number; // Target RPS
  };
  // Error rate thresholds (percentage)
  errorRate: {
    max: number;    // Maximum acceptable error rate
  };
  // Database-specific thresholds
  database?: {
    queryLatency: {
      p50: number;
      p95: number;
      p99: number;
    };
    connectionPool: {
      maxUtilization: number; // Maximum pool utilization percentage
    };
  };
}

// Default configuration
export const defaultConfig: PerformanceConfig = {
  server: {
    url: process.env.TEST_SERVER_URL || 'http://localhost:5000',
    port: parseInt(process.env.TEST_SERVER_PORT || '5000'),
  },
  scenarios: [
    // API Endpoints - Public and simple endpoints first
    {
      name: 'Health Check',
      description: 'Basic health check endpoint',
      endpoint: '/health',
      method: 'GET',
      category: 'api',
      load: {
        connections: 10,
        amount: 1000,
        pipelining: 1,
        timeout: 5000,
      },
    },
    {
      name: 'Contact Form',
      description: 'Public contact endpoint',
      endpoint: '/api/v1/contact',
      method: 'POST',
      category: 'api',
      body: {
        name: 'Performance Test',
        email: 'test@example.com',
        message: 'Performance test message',
      },
      load: {
        connections: 10,
        amount: 200,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Job Listings',
      description: 'Public job listings endpoint',
      endpoint: '/api/v1/jobs',
      method: 'GET',
      category: 'api',
      load: {
        connections: 15,
        amount: 300,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Templates',
      description: 'Public templates endpoint',
      endpoint: '/api/v1/templates',
      method: 'GET',
      category: 'api',
      load: {
        connections: 15,
        amount: 300,
        pipelining: 1,
        timeout: 10000,
      },
    },
    // Authenticated endpoints (marked as optional/skip if no auth)
    {
      name: 'Get Workspaces',
      description: 'Fetch all workspaces for authenticated user',
      endpoint: '/api/v1/workspaces',
      method: 'GET',
      category: 'api',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN, // Will be empty if not set
      },
      load: {
        connections: 10,
        amount: 200,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Get Tasks',
      description: 'Fetch tasks for a project',
      endpoint: '/api/v1/tasks',
      method: 'GET',
      category: 'api',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      load: {
        connections: 10,
        amount: 200,
        pipelining: 1,
        timeout: 15000,
      },
    },
    {
      name: 'Get Activities',
      description: 'Fetch activity feed',
      endpoint: '/api/v1/activities',
      method: 'GET',
      category: 'api',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      load: {
        connections: 10,
        amount: 200,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Get Calendar Aggregates',
      description: 'Fetch calendar aggregates',
      endpoint: '/api/v1/calendar/aggregates',
      method: 'GET',
      category: 'api',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      load: {
        connections: 10,
        amount: 200,
        pipelining: 1,
        timeout: 10000,
      },
    },
    // ─── AUTH LIFECYCLE ──────────────────────────────────────────────────────────
    {
      name: 'Auth - Token Exchange',
      description: 'Exchange proof for tokens',
      endpoint: '/api/v1/auth/exchange',
      method: 'POST',
      category: 'service',
      body: {
        userId: 'perf-user-id', // Should be dynamically resolved or a known test ID
        email: 'perf-test@example.com',
        role: 'ADMIN',
        sessionId: 'perf-session-123',
        timestamp: Date.now(),
        signature: 'fake-signature', // In a real test, we'd need to generate a valid HMAC
      },
      load: {
        connections: 5,
        amount: 100,
        pipelining: 1,
        timeout: 5000,
      },
    },
    {
      name: 'Auth - Token Refresh',
      description: 'Refresh access token using refresh token',
      endpoint: '/api/v1/auth/refresh',
      method: 'POST',
      category: 'service',
      body: {
        refreshToken: 'fake-refresh-token',
      },
      load: {
        connections: 5,
        amount: 100,
        pipelining: 1,
        timeout: 5000,
      },
    },
    // ─── WRITE OPERATIONS ───────────────────────────────────────────────────────
    {
      name: 'Workspace - Create',
      description: 'Create a new workspace',
      endpoint: '/api/v1/workspaces',
      method: 'POST',
      category: 'database',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      body: {
        name: 'Performance Test Workspace',
        slug: `perf-ws-${Date.now()}`,
      },
      load: {
        connections: 5,
        amount: 50,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Task - Create',
      description: 'Create a new task',
      endpoint: '/api/v1/tasks',
      method: 'POST',
      category: 'database',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      body: {
        title: 'Performance Test Task',
        description: 'Testing write throughput',
        priority: 'MEDIUM',
        status: 'TODO',
      },
      load: {
        connections: 5,
        amount: 100,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Task - Update',
      description: 'Update task details',
      endpoint: '/api/v1/tasks/test-task-id', // Using a dummy ID
      method: 'PATCH',
      category: 'database',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      body: {
        title: 'Updated Performance Task',
      },
      load: {
        connections: 5,
        amount: 50,
        pipelining: 1,
        timeout: 10000,
      },
    },
    {
      name: 'Task - Update Status',
      description: 'Update task status',
      endpoint: '/api/v1/tasks/test-task-id/status', // Using a dummy ID
      method: 'PATCH',
      category: 'database',
      auth: {
        type: 'bearer',
        token: process.env.AUTH_TOKEN,
      },
      body: {
        status: 'IN_PROGRESS',
      },
      load: {
        connections: 5,
        amount: 50,
        pipelining: 1,
        timeout: 10000,
      },
    },
    // Database Operations - Simple reads
    // Database Operations - Simple reads
    {
      name: 'Database Query - Simple Read',
      description: 'Simple database read operation',
      endpoint: '/health',
      method: 'GET',
      category: 'database',
      load: {
        connections: 20,
        amount: 1000,
        pipelining: 1,
        timeout: 5000,
      },
    },
    // Service Layer Operations - Lightweight services
    {
      name: 'Service - Health Check',
      description: 'Simple service health check',
      endpoint: '/health',
      method: 'GET',
      category: 'service',
      load: {
        connections: 15,
        amount: 500,
        pipelining: 1,
        timeout: 5000,
      },
    },
  ],
  thresholds: {
    responseTime: {
      p50: 300,    // 50% of requests should complete within 300ms
      p95: 500,    // 95% of requests should complete within 500ms
      p99: 1000,   // 99% of requests should complete within 1s
      max: 5000,   // No request should take longer than 5s
    },
    throughput: {
      min: 40,     // Minimum 40 RPS
      target: 100, // Target 100 RPS
    },
    errorRate: {
      max: 1,      // Maximum 1% error rate
    },
    database: {
      queryLatency: {
        p50: 150,
        p95: 200,
        p99: 500,
      },
      connectionPool: {
        maxUtilization: 80, // Maximum 80% pool utilization
      },
    },
  },
  reporting: {
    outputDir: './performance/results',
    formats: ['json', 'console'],
  },
};

// Load test configurations for different scenarios
export const loadTestProfiles = {
  // Baseline: Normal traffic patterns
  baseline: {
    connections: 10,
    amount: 1000,
    rate: 10,
  },
  // Peak: Simulated peak traffic
  peak: {
    connections: 50,
    amount: 5000,
    rate: 50,
  },
  // Stress: Beyond normal capacity
  stress: {
    connections: 100,
    amount: 10000,
    rate: 100,
  },
  // Spike: Sudden traffic spikes
  spike: {
    connections: 200,
    amount: 2000,
    rate: 200,
  },
};
