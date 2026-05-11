import crypto from 'crypto';
import { Request } from 'express';

export interface DeviceFingerprint {
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  ipAddress: string;
}

export interface SessionMetadata {
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  location?: string;
  lastActivity: number;
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
  
  return req.socket.remoteAddress || 'unknown';
}

export function createSessionMetadata(req: Request): SessionMetadata {
  return {
    deviceId: generateDeviceFingerprint(req),
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