import * as Sentry from "@sentry/node";

/**
 * Initialize Sentry for error tracking and performance monitoring
 */
export const initSentry = (): void => {
  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
  const release = process.env.SENTRY_RELEASE;

  if (!dsn) {
    console.log("⚠️  Sentry DSN not configured - error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment,
    release,
    
    // Set traces sample rate to capture 10% of transactions in production
    // Adjust this value in production as needed
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
    
    // Capture replay sessions when users encounter errors
    // Note: Session Replay requires additional SDK installation
    // replaysSessionSampleRate: 0.1,
    // replaysOnErrorSampleRate: 1.0,
    
    // Filter out sensitive data
    beforeSend(event, hint) {
      // Remove sensitive headers and data
      if (event.request) {
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      
      // Filter out health check endpoints
      if (event.request?.url?.includes("/health")) {
        return null;
      }
      
      return event;
    },
    
    // Attach stack traces to all errors
    attachStacktrace: true,
    
    // Normalize maximum depth of objects
    normalizeDepth: 10,
    
    // Maximum number of breadcrumbs
    maxBreadcrumbs: 50,
  });
  
  console.log(`✅ Sentry initialized in ${environment} mode${release ? ` (release: ${release})` : ''}`);
};

/**
 * Capture exception and send to Sentry
 */
export const captureException = (error: Error, context?: Record<string, any>): void => {
  Sentry.captureException(error, {
    extra: context,
  });
};

/**
 * Capture message and send to Sentry
 */
export const captureMessage = (message: string, level: Sentry.SeverityLevel = "info", context?: Record<string, any>): void => {
  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
};

/**
 * Set user context for Sentry
 */
export const setUserContext = (user: { id: string; email?: string; username?: string }): void => {
  Sentry.setUser(user);
};

/**
 * Clear user context
 */
export const clearUserContext = (): void => {
  Sentry.setUser(null);
};

/**
 * Add breadcrumb for better error tracking
 */
export const addBreadcrumb = (breadcrumb: Sentry.Breadcrumb): void => {
  Sentry.addBreadcrumb(breadcrumb);
};

/**
 * Create a span for performance monitoring
 */
export const startTransaction = (name: string, op: string): any => {
  return Sentry.startSpan({
    name,
    op,
  }, (span) => {
    return span;
  });
};