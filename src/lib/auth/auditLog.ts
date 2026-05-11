export type AuditEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED"
  | "LOGOUT"
  | "LOGOUT_ALL_DEVICES"
  | "TOKEN_REFRESHED"
  | "TOKEN_REVOKED"
  | "TOKEN_EXPIRED"
  | "TOKEN_VERSION_MISMATCH"
  | "TOKEN_REPLAY_DETECTED"
  | "EXCHANGE_SUCCESS"
  | "EXCHANGE_FAILED"
  | "SSE_CONNECTED"
  | "SSE_DISCONNECTED"
  | "ACCOUNT_LOCKED"
  | "PERMISSION_DENIED"
  | "EMAIL_NOT_VERIFIED"
  // Session security events
  | "SESSION_HIJACK_DETECTED"
  | "MAX_SESSIONS_REACHED"
  | "DEVICE_MISMATCH"
  | "SUSPICIOUS_IP_CHANGE"
  // CSRF events
  | "CSRF_VALIDATION_FAILED"
  // Security events
  | "UNAUTHORIZED_ACCESS"
  | "RATE_LIMIT_EXCEEDED"
  | "MALWARE_DETECTED"
  | "SUSPICIOUS_ACTIVITY"
  // Data events
  | "DATA_EXPORT"
  | "DATA_DELETION"
  | "SENSITIVE_DATA_ACCESS"
  // Workspace events
  | "WORKSPACE_CREATED"
  | "WORKSPACE_DELETED"
  | "MEMBER_ADDED"
  | "MEMBER_REMOVED"
  | "ROLE_CHANGED"
  // Billing events
  | "SUBSCRIPTION_CREATED"
  | "SUBSCRIPTION_CANCELLED"
  | "PAYMENT_FAILED";

interface AuditEvent {
  event: AuditEventType;
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
  jti?: string;
  reason?: string;
  meta?: Record<string, unknown>;
  timestamp: string;
  severity: "info" | "warn" | "critical";
}

const SEVERITY: Record<AuditEventType, AuditEvent["severity"]> = {
  // Auth events
  LOGIN_SUCCESS: "info",
  LOGIN_FAILED: "warn",
  LOGIN_BLOCKED: "warn",
  LOGOUT: "info",
  LOGOUT_ALL_DEVICES: "info",

  // Token events
  TOKEN_REFRESHED: "info",
  TOKEN_REVOKED: "info",
  TOKEN_EXPIRED: "info",
  TOKEN_VERSION_MISMATCH: "warn",
  TOKEN_REPLAY_DETECTED: "critical",
  EXCHANGE_SUCCESS: "info",
  EXCHANGE_FAILED: "warn",

  // SSE events
  SSE_CONNECTED: "info",
  SSE_DISCONNECTED: "info",

  // Account events
  ACCOUNT_LOCKED: "critical",
  PERMISSION_DENIED: "warn",
  EMAIL_NOT_VERIFIED: "warn",

  // Session security
  SESSION_HIJACK_DETECTED: "critical",
  MAX_SESSIONS_REACHED: "warn",
  DEVICE_MISMATCH: "warn",
  SUSPICIOUS_IP_CHANGE: "warn",

  // CSRF
  CSRF_VALIDATION_FAILED: "warn",

  // Security
  UNAUTHORIZED_ACCESS: "warn",
  RATE_LIMIT_EXCEEDED: "warn",
  MALWARE_DETECTED: "critical",
  SUSPICIOUS_ACTIVITY: "warn",

  // Data
  DATA_EXPORT: "info",
  DATA_DELETION: "critical",
  SENSITIVE_DATA_ACCESS: "warn",

  // Workspace
  WORKSPACE_CREATED: "info",
  WORKSPACE_DELETED: "critical",
  MEMBER_ADDED: "info",
  MEMBER_REMOVED: "info",
  ROLE_CHANGED: "info",

  // Billing
  SUBSCRIPTION_CREATED: "info",
  SUBSCRIPTION_CANCELLED: "info",
  PAYMENT_FAILED: "warn",
};

export function auditLog(
  event: AuditEventType,
  data: Omit<AuditEvent, "event" | "timestamp" | "severity">,
): void {
  const entry: AuditEvent = {
    event,
    severity: SEVERITY[event],
    timestamp: new Date().toISOString(),
    ...data,
  };

  const output = JSON.stringify(entry);

  if (entry.severity === "critical") {
    console.error(`[AUDIT:CRITICAL] ${output}`);
  } else if (entry.severity === "warn") {
    console.warn(`[AUDIT:WARN] ${output}`);
  } else {
    console.log(`[AUDIT:INFO] ${output}`);
  }

  // Production: await prisma.auditLog.create({ data: entry });
}
