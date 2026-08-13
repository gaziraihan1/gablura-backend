// ═══════════════════════════════════════════════════════════════
// Security Headers Middleware
// ═══════════════════════════════════════════════════════════════

import { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

const isProd = process.env.NODE_ENV === 'production';
const API_URL = process.env.BACKEND_URL || 'http://localhost:5000';

/**
 * Single source of truth for the security-header stack shared by BOTH app
 * instances (src/index.ts server entry and src/app.ts used by integration
 * tests). helmet applies its baseline protections; securityHeaders then
 * applies the explicit Focura header policy — its values intentionally win
 * where they overlap with helmet's defaults (CSP, X-Frame-Options, CORP).
 */
export function applySecurity(app: Application): void {
  const allowedOrigins = [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    ...(!isProd ? ['http://localhost:3000', 'http://localhost:3001'] : []),
  ].filter(Boolean) as string[];

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https:"],
              fontSrc: ["'self'", "data:"],
              connectSrc: ["'self'", ...allowedOrigins],
              frameSrc: ["'none'"],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              mediaSrc: ["'self'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  app.use(securityHeaders);
}

/**
 * Security Headers Middleware
 * Adds CSP, X-Frame-Options, HSTS, and other security headers
 */
export const securityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Content Security Policy (CSP)
  const cspDirectives = [
    "default-src 'self'",                        // Deny all by default
    "script-src 'self' 'unsafe-inline'",         // Scripts from self + inline
    "style-src 'self' 'unsafe-inline'",          // Styles from self + inline
    "img-src 'self' data: https:",               // Images from self, data URIs, HTTPS
    `connect-src 'self' ${API_URL}`,             // API requests to backend only
    "form-action 'self'",                        // Forms can only submit to same origin
    "frame-ancestors 'none'",                    // No external iframes
    "object-src 'none'",                         // No plugins (Flash, etc.)
    "base-uri 'self'",                           // Base URL can only be set to self
    "font-src 'self' data:",                     // Fonts from self and data URIs
    "media-src 'self'",                          // Media from self only
  ].join('; ');

  res.setHeader('Content-Security-Policy', cspDirectives);

  // X-Frame-Options: Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // X-Content-Type-Options: Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Referrer-Policy: Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy (formerly Feature-Policy)
  const permissionsPolicy = [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
  ].join(', ');
  res.setHeader('Permissions-Policy', permissionsPolicy);

  // HSTS: Force HTTPS in production
  if (isProd) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Cross-Origin-Embedder-Policy
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  // Cross-Origin-Opener-Policy
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // Cross-Origin-Resource-Policy
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  next();
};