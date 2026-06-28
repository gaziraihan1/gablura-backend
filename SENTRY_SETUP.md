# Sentry Error Tracking Setup

This project now includes Sentry for comprehensive error tracking and performance monitoring.

## Installation

Sentry has been installed with the following packages:
- `@sentry/node` - Core Sentry SDK for Node.js
- `@sentry/tracing` - Performance monitoring and distributed tracing

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# Required: Sentry DSN (Data Source Name)
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0

# Optional: Override the environment (defaults to NODE_ENV)
SENTRY_ENVIRONMENT=production

# Optional: Set release version for tracking deployments
SENTRY_RELEASE=focura-backend@1.0.0
```

### Getting Your Sentry DSN

1. Create a Sentry account at https://sentry.io
2. Create a new project
3. Select "Node.js" as the platform
4. Copy the DSN from the project settings

## Features

### Automatic Error Tracking

- **Unhandled Errors**: All unhandled exceptions and promise rejections are automatically captured
- **Express Integration**: Errors in Express routes are captured with request context
- **Authentication Context**: User information is automatically attached when authenticated
- **Sensitive Data Filtering**: Authorization headers and cookies are automatically removed

### Performance Monitoring

- **HTTP Tracing**: All HTTP requests are traced for performance analysis
- **Transaction Sampling**: 10% of transactions are sampled in production (100% in development)
- **Custom Transactions**: Use `startTransaction()` for custom performance tracking

### User Context

When users authenticate, their information is automatically attached to error events:
- User ID
- Email
- Username (if available)

This helps you understand which users are affected by errors.

## Usage

### Manual Error Capture

```typescript
import { captureException, captureMessage } from '../lib/sentry.js';

try {
  // Your code that might fail
} catch (error) {
  // Capture the exception with additional context
  captureException(error, {
    userId: user.id,
    action: 'payment_processing',
  });
}
```

### Custom Messages

```typescript
import { captureMessage } from '../lib/sentry.js';

// Send informational messages
captureMessage('User completed onboarding', 'info', { userId: user.id });

// Send warnings
captureMessage('API rate limit approaching', 'warning', { 
  currentUsage: 95,
  limit: 100 
});
```

### User Context

```typescript
import { setUserContext, clearUserContext } from '../lib/sentry.js';

// Set user context manually
setUserContext({
  id: 'user-123',
  email: 'user@example.com',
  username: 'johndoe',
});

// Clear user context (e.g., on logout)
clearUserContext();
```

### Breadcrumbs

```typescript
import { addBreadcrumb } from '../lib/sentry.js';

// Add breadcrumbs for better error context
addBreadcrumb({
  category: 'user',
  message: 'User clicked save button',
  level: 'info',
  data: {
    userId: user.id,
    page: '/settings',
  },
});
```

### Performance Monitoring

```typescript
import { startTransaction } from '../lib/sentry.js';

// Create a custom transaction
const transaction = startTransaction(
  'database-migration',
  'db.operation'
);

try {
  // Your operation
  await performMigration();
  transaction.setStatus('ok');
} catch (error) {
  transaction.setStatus('internal_error');
  throw error;
} finally {
  transaction.finish();
}
```

## Architecture

### Files Modified

1. **`src/lib/sentry.ts`** - Sentry configuration and utility functions
2. **`src/index.ts`** - Sentry initialization and global error handlers
3. **`src/errors/errorHandler.ts`** - Integration with Express error handling
4. **`src/middleware/auth.ts`** - User context attachment on authentication
5. **`.env.example`** - Environment variable documentation

### Error Flow

1. Error occurs in application
2. Global error handler catches it
3. Error is sent to Sentry with context
4. Sentry processes and alerts you
5. You can view and analyze in Sentry dashboard

## Development vs Production

### Development Mode
- 100% transaction sampling
- Full stack traces
- Console logging enabled
- All errors sent to Sentry

### Production Mode
- 10% transaction sampling (configurable)
- Full stack traces
- Console logging disabled for security
- All errors sent to Sentry

## Security

### Sensitive Data Protection

The Sentry implementation automatically filters:
- Authorization headers
- Cookie headers
- Health check endpoints (`/health`, `/health/db-pool`)

### Recommendations

1. Never commit your `.env` file with real Sentry DSN
2. Use different Sentry projects for development and production
3. Review Sentry's security documentation for additional hardening
4. Regularly audit your Sentry alerts and permissions

## Troubleshooting

### Sentry Not Initializing

If you see "⚠️ Sentry DSN not configured - error tracking disabled":
- Check that `SENTRY_DSN` is set in your `.env` file
- Ensure your `.env` file is being loaded (check dotenv configuration)
- Verify the DSN format is correct

### Errors Not Appearing in Sentry

1. Check your Sentry project settings
2. Verify the DSN matches your project
3. Check network connectivity to Sentry servers
4. Review browser console/network tab for failed requests

### Performance Impact

Sentry is designed to have minimal performance impact:
- Asynchronous error sending
- Sampling reduces overhead in production
- No blocking operations on the main thread

## Additional Features

To enable additional Sentry features, consider:

### Session Replay
Install `@sentry/replay` and uncomment the replay configuration in `src/lib/sentry.ts`

### Profiling
Profiling requires additional setup. Uncomment the profiling integration in `src/lib/sentry.ts` and install required dependencies.

### Express Integration
For deeper Express integration, uncomment and configure the Express integration in `src/lib/sentry.ts`

## Support

For issues specific to Sentry:
- Sentry Documentation: https://docs.sentry.io
- Sentry Support: https://sentry.io/support/

For implementation issues in this project:
- Check the code comments in `src/lib/sentry.ts`
- Review the error handling in `src/errors/errorHandler.ts`
- Ensure environment variables are properly configured