import crypto from 'crypto';
import { Request } from 'express';

export interface DeviceFingerprint {
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  ipAddress: string;
}

export interface SessionMetadata {
  /**
   * Device fingerprint of the session. `null` means the binding is pending:
   * the session was minted by the server-to-server token exchange (NextAuth),
   * which has no browser headers, so the middleware binds it to the first real
   * browser request instead of rejecting it as a DEVICE_MISMATCH.
   */
  deviceId: string | null;
  ipAddress: string;
  userAgent: string;
  location?: string;
  lastActivity: number;
}

const SERVER_TO_SERVER_UA =
  /^(node|undici|axios|curl|go-http-client|python-requests|java\/|okhttp|superagent)/i;

/**
 * True when the request carries no browser signals. NextAuth performs the
 * token exchange server-side (Node fetch/undici): no Accept-Language header
 * and a runtime user-agent. Browsers always send Accept-Language plus a
 * recognizable user-agent.
 */
/**
 * True when a user-agent belongs to a server runtime (Node fetch/undici,
 * curl, axios, etc.) rather than a browser.
 */
export function looksLikeServerToServerUA(userAgent: string): boolean {
  return !userAgent || SERVER_TO_SERVER_UA.test(userAgent);
}

/**
 * True when the request carries no browser signals. NextAuth performs the
 * token exchange server-side (Node fetch/undici): no Accept-Language header
 * and a runtime user-agent. Browsers always send Accept-Language plus a
 * recognizable user-agent.
 */
export function looksLikeServerToServerRequest(req: Request): boolean {
  const ua = (req.headers["user-agent"] as string | undefined) ?? "";
  if (looksLikeServerToServerUA(ua)) {
    return true;
  }
  return !req.headers["accept-language"] && !req.headers["accept-encoding"];
}

export function generateDeviceFingerprint(req: Request): string {
  const components = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(components)
    .digest('hex')
    .substring(0, 32);
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  
  const ip = req.socket.remoteAddress || 'unknown';
  // Normalize IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1` → `127.0.0.1`)
  // so the same localhost client is not seen as a different IP across
  // requests, which would false-positive the 5-minute IP-change check.
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function createSessionMetadata(req: Request): SessionMetadata {
  // The token exchange always runs server-to-server (NextAuth's server-side
  // fetch), so this request can never fingerprint the end-user's device. The
  // binding is always left pending and adopted from the first real browser
  // request by the auth middleware.
  return {
    deviceId: null,
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    lastActivity: Date.now(),
  };
}

export function validateSessionBinding(
  req: Request,
  storedMetadata: SessionMetadata
): {
  valid: boolean;
  reason?: string;
} {
  const currentDeviceId = generateDeviceFingerprint(req);
  const currentIp = getClientIp(req);

  if (currentDeviceId !== storedMetadata.deviceId) {
    return {
      valid: false,
      reason: 'DEVICE_MISMATCH',
    };
  }
  if (currentIp !== storedMetadata.ipAddress) {
    const timeSinceLastActivity = Date.now() - storedMetadata.lastActivity;
    const maxIpChangeInterval = 5 * 60 * 1000; // 5 minutes

    if (timeSinceLastActivity < maxIpChangeInterval) {
      return {
        valid: false,
        reason: 'SUSPICIOUS_IP_CHANGE',
      };
    }
  }

  return { valid: true };
}