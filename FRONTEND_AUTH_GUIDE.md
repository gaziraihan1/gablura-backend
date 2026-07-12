# Frontend Authentication Guide

A complete reference for the Next.js frontend team on how to integrate with the Focura backend authentication system.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Token Types & Lifecycle](#2-token-types--lifecycle)
3. [Login Flow (Exchange)](#3-login-flow-exchange)
4. [Making Authenticated Requests](#4-making-authenticated-requests)
5. [Token Refresh Flow](#5-token-refresh-flow)
6. [Logout Flow](#6-logout-flow)
7. [CSRF Protection](#7-csrf-protection)
8. [Server-Sent Events (SSE)](#8-server-sent-events-sse)
9. [Error Handling Reference](#9-error-handling-reference)
10. [Session Management](#10-session-management)
11. [Rate Limiting](#11-rate-limiting)
12. [Token Storage Strategy](#12-token-storage-strategy)
13. [Security Do's and Don'ts](#13-security-dos-and-donts)
14. [Environment Variables](#14-environment-variables)
15. [Common Pitfalls & Troubleshooting](#15-common-pitfalls--troubleshooting)
16. [API Quick Reference](#16-api-quick-reference)

---

## 1. Architecture Overview

Focura uses a **split-auth architecture** with three tiers:

```
Browser (React)            Next.js (NextAuth)           Express Backend
      │                          │                            │
      │── 1. Login (OAuth) ────>│                            │
      │                          │── 2. HMAC Proof ─────────>│
      │                          │   POST /auth/exchange      │
      │                          │                            │── 3. Verify HMAC
      │                          │                            │── 4. Sign RS256 JWTs
      │                          │<── 5. { accessToken,       │
      │                          │       refreshToken }       │
      │<── 6. NextAuth Session ──│   (stored in HTTP-only     │
      │    (HTTP-only cookie)    │    NextAuth JWT cookie)    │
      │                          │                            │
      │── 7. API Request ───────────────────────────────────>│
      │   Authorization: Bearer <accessToken>                │
      │   x-csrf-token: <csrfToken>                          │
      │<── 8. Response ─────────────────────────────────────│
```

### Core Principles

| Principle | Detail |
|-----------|--------|
| **Backend is the sole JWT authority** | The RS256 private key never leaves the Express server. The frontend never signs JWTs. |
| **NextAuth manages sessions** | The browser never sees refresh tokens. They live inside the NextAuth HTTP-only JWT cookie. |
| **No auth cookies from backend** | The backend returns tokens in JSON response bodies. The frontend stores them. |
| **Stateless exchange** | The HMAC proof is a one-shot, stateless credential — no extra database round-trip needed. |
| **Asymmetric signing (RS256)** | Private key signs, public key verifies. This means the frontend (or any service with the public key) can verify tokens without being able to create them. |

### What Each Tier Owns

| Tier | Responsibilities |
|------|-----------------|
| **Browser (React)** | Stores access token in memory. Sends `Authorization` and `x-csrf-token` headers. Triggers refresh before expiry. Handles `401` by redirecting to login. |
| **Next.js (NextAuth)** | Manages user session via HTTP-only cookie. Generates HMAC-signed proof on login. Silently refreshes backend tokens. Proxies API calls server-side. |
| **Express Backend** | Signs RS256 JWTs. Verifies HMAC proofs. Stores refresh tokens in Redis. Enforces CSRF, rate limiting, session binding. |

---

## 2. Token Types & Lifecycle

### Access Token

| Property | Value |
|----------|-------|
| Algorithm | RS256 |
| Expiry | **15 minutes** |
| Issuer | `focura-app` |
| Audience | `focura-backend` |
| Stored in | Frontend memory (not HTTP-only cookie) |

**Payload:**

```typescript
interface AccessTokenPayload {
  sub: string;        // User ID
  email: string;      // User email
  role: string;       // "USER" | "ADMIN"
  type: "access";
  version: number;    // Must equal 1 (CURRENT_TOKEN_VERSION)
  jti: string;        // Unique token ID (UUID v4)
  sessionId: string;  // Ties token to a login session
  iss: "focura-app";
  aud: "focura-backend";
}
```

### Refresh Token

| Property | Value |
|----------|-------|
| Algorithm | RS256 |
| Expiry | **7 days** |
| Stored in | Redis (backend) + NextAuth cookie (frontend) |
| Rotated | **On every use** — single-use only |

**Payload:** Same as access token, but `type: "refresh"`.

**Rotation behavior:**
- Every `POST /auth/refresh` consumes the old refresh token and issues a new pair
- Reusing an already-consumed refresh token triggers `TOKEN_REPLAY_DETECTED` (critical security event)
- The frontend never directly sends refresh tokens to the backend — NextAuth handles this server-side

### SSE Token

| Property | Value |
|----------|-------|
| Algorithm | RS256 |
| Expiry | **30 seconds** |
| Use case | One-time authentication for SSE stream connections |

**Payload:**

```typescript
interface SseTokenPayload {
  sub: string;        // User ID
  type: "sse";
  version: number;
  jti: string;
  // No email, role, or sessionId
}
```

### Token Lifecycle Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              TOKEN LIFECYCLE                 │
                    └─────────────────────────────────────────────┘

  Login                 Active                  Refresh               Expired/Revoked
    │                     │                       │                       │
    ▼                     ▼                       ▼                       ▼
 ┌──────┐           ┌──────────┐           ┌──────────┐           ┌──────────┐
 │ISSUED│──────────>│  VALID   │──────────>│ ROTATED  │──────────>│ REVOKED  │
 │      │  15 min   │          │  before   │          │  old jti  │          │
 │access│  window   │ access   │  expiry   │ new pair │  stored   │ access   │
 │  +   │           │ token    │           │ issued   │  in Redis │ token    │
 │refresh│           │ accepted │           │          │  for 15m  │ black-   │
 └──────┘           └──────────┘           └──────────┘           │ listed   │
                                                                  └──────────┘
```

---

## 3. Login Flow (Exchange)

The login flow is a two-step process: NextAuth authenticates the user, then the backend issues RS256 JWTs via an HMAC-signed proof exchange.

### Step-by-Step Flow

```
1. User clicks "Login with Google" (or any OAuth provider)
2. NextAuth redirects to OAuth provider → user authenticates
3. NextAuth jwt callback fires:
   a. Generate sessionId (UUID)
   b. Construct proof: `${userId}${email}${role}${sessionId}${timestamp}`
   c. Sign proof: HMAC-SHA256(proof, NEXTAUTH_SECRET)
   d. POST to backend: /api/v1/auth/exchange
4. Backend validates:
   a. Proof is < 60 seconds old
   b. HMAC signature matches
   c. User exists in database
   d. Email is verified (or auto-verifies on first exchange)
5. Backend returns: { accessToken, refreshToken, accessTokenExpiry, refreshTokenExpiry }
6. NextAuth stores tokens in HTTP-only JWT cookie
7. Browser receives NextAuth session cookie
```

### HMAC Proof Construction

```typescript
import crypto from "crypto";

interface ExchangeProof {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
  timestamp: number;
  signature: string;
}

function buildExchangeProof(
  userId: string,
  email: string,
  role: string,
  sessionId: string
): ExchangeProof {
  const timestamp = Date.now();
  const payload = `${userId}${email}${role}${sessionId}${timestamp}`;

  const signature = crypto
    .createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(payload)
    .digest("hex");

  return { userId, email, role, sessionId, timestamp, signature };
}
```

### Exchange Endpoint

```
POST /api/v1/auth/exchange
Content-Type: application/json

{
  "userId": "cml4r530o0003...",
  "email": "user@example.com",
  "role": "USER",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1719876543123,
  "signature": "a1b2c3d4e5f6..."
}
```

### Success Response

```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs...",
  "accessTokenExpiry": 1719877443123,
  "refreshTokenExpiry": 1720481343123
}
```

### Error Responses

| Status | Code | When |
|--------|------|------|
| `400` | `MISSING_FIELDS` | Body missing required fields |
| `401` | `PROOF_EXPIRED` | Timestamp > 60 seconds old |
| `401` | `INVALID_PROOF` | HMAC signature mismatch |
| `401` | `USER_NOT_FOUND` | User ID doesn't exist in DB |
| `401` | `EMAIL_NOT_VERIFIED` | Email not verified and doesn't match |

### Idempotency

The exchange endpoint is **idempotent for 90 seconds** per `sessionId`. If the same `sessionId` is used in a duplicate request within 90 seconds, the backend returns the cached token pair from the first successful exchange.

---

## 4. Making Authenticated Requests

### Required Headers

Every API request to protected endpoints must include:

```typescript
const headers = {
  "Authorization": `Bearer ${accessToken}`,
  "x-csrf-token": csrfToken,  // Required for POST/PUT/DELETE/PATCH
  "Content-Type": "application/json",
};
```

### Which Endpoints Require What

| Endpoint Category | Auth Required | CSRF Required |
|-------------------|---------------|---------------|
| `GET /api/v1/csrf-token` | Yes (Bearer) | No |
| `POST /api/v1/auth/exchange` | No | No |
| `POST /api/v1/auth/refresh` | No | No |
| `POST /api/v1/auth/logout` | Optional* | No |
| `GET /api/v1/notifications/stream` | Query param | No |
| `GET` on any resource | Yes (Bearer) | **No** (safe methods exempt) |
| `POST/PUT/DELETE/PATCH` on any resource | Yes (Bearer) | **Yes** |

*Logout accepts an optional Bearer token. It always returns 200 even if the token is expired or missing.

### Axios Interceptor Setup

```typescript
import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: false, // We use Authorization header, not cookies
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = getAccessToken(); // Your token storage function
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Attach CSRF token for state-changing methods
  if (["post", "put", "patch", "delete"].includes(config.method!)) {
    const csrfToken = getCsrfToken(); // Your CSRF storage function
    if (csrfToken) {
      config.headers["x-csrf-token"] = csrfToken;
    }
  }

  return config;
});

// Handle 401 errors globally
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Attempt token refresh
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        // Retry with new token
        originalRequest.headers.Authorization = `Bearer ${getAccessToken()}`;
        return api(originalRequest);
      }

      // Refresh failed — redirect to login
      redirectToLogin();
    }

    return Promise.reject(error);
  }
);
```

---

## 5. Token Refresh Flow

### When to Refresh

Refresh the access token **1 minute before it expires**. The `accessTokenExpiry` from the exchange/refresh response tells you the exact expiry timestamp.

```typescript
function getTimeUntilRefresh(accessExpiry: number): number {
  const now = Date.now();
  const oneMinute = 60 * 1000;
  return Math.max(0, accessExpiry - now - oneMinute);
}
```

### Refresh Endpoint

```
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

### Success Response

```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJSUzI1NiIs...(new)",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs...(new)",
  "accessTokenExpiry": 1719877443123,
  "refreshTokenExpiry": 1720481343123
}
```

### Important: Refresh Rotation

Every refresh call returns a **new refresh token**. The old one is consumed and cannot be reused. Store the new refresh token immediately after a successful refresh.

```
Refresh Token Lifecycle:

  RT-v1 (issued at login)
    │
    ├── POST /refresh with RT-v1
    │     └── Returns RT-v2 + new AT
    │
    ├── RT-v1 is now INVALID (deleted from Redis)
    │
    ├── POST /refresh with RT-v2
    │     └── Returns RT-v3 + new AT
    │
    └── RT-v2 is now INVALID
```

### Concurrent Refresh Protection

If multiple tabs or requests try to refresh simultaneously:

1. The backend acquires a **distributed lock** (45-second TTL) per session
2. If the lock is held, the second request **polls for the cached result** (up to 300ms)
3. If no cached result appears, returns `429 REFRESH_IN_PROGRESS` with `retryAfter: 1`

**Frontend handling:**

```typescript
async function attemptTokenRefresh(): Promise<boolean> {
  try {
    const response = await axios.post("/api/v1/auth/refresh", {
      refreshToken: getRefreshToken(),
    });

    const { accessToken, refreshToken, accessTokenExpiry } = response.data;
    storeAccessToken(accessToken);
    storeRefreshToken(refreshToken);
    storeAccessExpiry(accessTokenExpiry);
    return true;
  } catch (error) {
    if (error.response?.status === 429 && 
        error.response?.data?.code === "REFRESH_IN_PROGRESS") {
      // Another request is already refreshing — wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return attemptTokenRefresh(); // Retry once
    }

    if (error.response?.data?.code === "TOKEN_REPLAY_DETECTED") {
      // Refresh token was reused — security violation
      // Clear all tokens and redirect to login immediately
      clearAllAuthState();
      redirectToLogin();
      return false;
    }

    return false;
  }
}
```

### Failure Degradation

If the refresh call fails (network error, backend down, etc.):

- **Do NOT** throw or force logout immediately
- The access token may still be valid for a few more minutes
- On the next API call, if the access token is expired, the backend returns `401 TOKEN_EXPIRED`
- At that point, the frontend can redirect to login

```typescript
// Graceful degradation pattern
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const code = error.response?.data?.code;

      switch (code) {
        case "TOKEN_EXPIRED":
          // Try refresh
          const refreshed = await attemptTokenRefresh();
          if (!refreshed) redirectToLogin();
          break;

        case "TOKEN_REVOKED":
        case "TOKEN_REPLAY_DETECTED":
          // Security issue — force logout immediately
          clearAllAuthState();
          redirectToLogin();
          break;

        case "SESSION_HIJACK_DETECTED":
          // Session compromised — force logout
          clearAllAuthState();
          redirectToLogin();
          break;

        default:
          redirectToLogin();
      }
    }
    return Promise.reject(error);
  }
);
```

---

## 6. Logout Flow

### Single Device Logout

```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>   (optional — works even if expired)
Content-Type: application/json

{
  "logoutAll": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**What happens backend-side:**
1. Extracts user identity from the Bearer token (best-effort)
2. Revokes the access token JTI in Redis (15-minute TTL)
3. Logs `LOGOUT` audit event

### All Devices Logout

```json
{
  "logoutAll": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "Logged out from all devices"
}
```

**What happens backend-side:**
1. Revokes the current access token JTI
2. Deletes **all** refresh tokens for the user from Redis
3. Every other session will fail to refresh and eventually expire
4. Logs `LOGOUT_ALL_DEVICES` audit event

### Key Behavior

- **Logout always returns 200** — even without a valid token, even if Redis is down
- The backend never blocks a logout request
- After calling logout, the frontend should clear all local state regardless of the response

### Frontend Logout Implementation

```typescript
async function logout(logoutAll = false): Promise<void> {
  try {
    await api.post("/api/v1/auth/logout", { logoutAll });
  } catch {
    // Logout is fire-and-forget — proceed with local cleanup regardless
  } finally {
    // Always clear local state
    clearAccessToken();
    clearRefreshToken();
    clearAccessExpiry();
    clearCsrfToken();
    clearNextAuthSession();
    redirectToLogin();
  }
}
```

---

## 7. CSRF Protection

### Overview

The backend uses a **server-side CSRF token system** stored in Redis. Tokens are NOT transmitted via cookies — they are sent via the `x-csrf-token` HTTP header.

### Fetching a CSRF Token

```
GET /api/v1/csrf-token
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "csrfToken": "a1b2c3d4e5f6g7h8i9j0...",
    "expiresIn": 3600
  }
}
```

**Key facts:**
- Token is **32 bytes** (256 bits) of randomness, encoded as base64url
- Stored in Redis at key `csrf:{userId}:{sessionId}` with **1-hour TTL**
- Tied to the specific user AND session — a token from session A won't work for session B
- The endpoint requires `authenticate` middleware (you must be logged in)
- The endpoint itself is **exempt from CSRF** (it's a GET)

### When CSRF Is Required

| HTTP Method | CSRF Required | Reason |
|-------------|---------------|--------|
| `GET` | **No** | Safe method — read-only |
| `HEAD` | **No** | Safe method |
| `OPTIONS` | **No** | Safe method |
| `POST` | **Yes** | State-changing |
| `PUT` | **Yes** | State-changing |
| `PATCH` | **Yes** | State-changing |
| `DELETE` | **Yes** | State-changing |

Webhook paths (`/webhooks/*`) are also exempt from CSRF.

### Sending the CSRF Token

```typescript
// Include in headers for state-changing requests
const response = await api.post("/api/v1/tasks", taskData, {
  headers: {
    "x-csrf-token": getCsrfToken(),
  },
});
```

### CSRF Token Lifecycle

```
Login
  │
  ├── Fetch CSRF token: GET /csrf-token
  │     └── Store in memory (NOT localStorage)
  │
  ├── Use on every POST/PUT/DELETE/PATCH
  │     └── Header: x-csrf-token: <token>
  │
  ├── Token expires after 1 hour
  │     └── Re-fetch: GET /csrf-token
  │
  └── On 403 CSRF_VALIDATION_FAILED
        └── Re-fetch CSRF token, then retry request
```

### Handling CSRF Errors

```typescript
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 && 
        error.response?.data?.code === "CSRF_VALIDATION_FAILED") {
      // CSRF token expired or invalid — fetch a new one
      await refreshCsrfToken();

      // Retry the original request with new CSRF token
      const originalRequest = error.config;
      originalRequest.headers["x-csrf-token"] = getCsrfToken();
      return api(originalRequest);
    }
    return Promise.reject(error);
  }
);
```

### Refreshing CSRF Token

```typescript
async function refreshCsrfToken(): Promise<string | null> {
  try {
    const response = await api.get("/api/v1/csrf-token");
    const newToken = response.data.data.csrfToken;
    storeCsrfToken(newToken);
    return newToken;
  } catch {
    return null;
  }
}
```

---

## 8. Server-Sent Events (SSE)

### Authentication

SSE connections are authenticated via a **query parameter** because `EventSource` doesn't support custom headers.

```
GET /api/v1/notifications/stream?token=<accessToken>
```

**Important:** The access token used for SSE is a **regular access token** (15-minute expiry). Some implementations use a short-lived SSE-specific token (30 seconds), but the standard flow uses the normal access token.

### Security Model

```
Client sends:  GET /stream?token=<accessToken>
Backend does:  verifyToken(token) → extracts userId from JWT
               clients.set(userId, res)  ← userId from token ONLY
```

The `userId` in the URL is **never trusted**. The backend always derives `userId` from the cryptographically verified token. A user cannot subscribe to another user's notification stream.

### Connection Flow

```
Frontend (useNotifications)          Backend
      │                                  │
      │── GET /stream?token=<jwt> ──────>│── verifyToken()
      │                                  │── userId from token
      │                                  │── clients.set(userId, res)
      │<── EventStream ─────────────────│
      │                                  │
      │  onmessage                       │
      │<── { type, ...notification } ───│── sendNotificationToUser(userId, data)
      │                                  │
      │── (disconnect) ─────────────────│── clients.delete(userId)
      │                                  │── audit log SSE_DISCONNECTED
```

### Reconnection Handling

- **Heartbeat:** Server sends `: heartbeat <timestamp>` every 30 seconds
- **Auto-reconnect:** If connection drops, reconnect after 5 seconds
- **Token rotation:** If the access token rotates during a refresh, the SSE connection should be re-established with the new token
- **One connection per user:** New connections replace previous ones

### Implementation Pattern

```typescript
function connectSSE(accessToken: string, onNotification: (data: any) => void) {
  const eventSource = new EventSource(
    `${API_URL}/api/v1/notifications/stream?token=${accessToken}`
  );

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onNotification(data);
  };

  eventSource.onerror = () => {
    eventSource.close();
    // Reconnect after 5 seconds
    setTimeout(() => connectSSE(accessToken, onNotification), 5000);
  };

  return eventSource;
}
```

### Cleanup

Always close the SSE connection on component unmount:

```typescript
useEffect(() => {
  const eventSource = connectSSE(accessToken, handleNotification);

  return () => {
    eventSource.close();
  };
}, [accessToken]);
```

---

## 9. Error Handling Reference

### Complete Error Code Table

| HTTP Status | Error Code | Meaning | Frontend Action |
|-------------|------------|---------|-----------------|
| `400` | `MISSING_FIELDS` | Request body missing required fields | Show validation error to user |
| `400` | `MISSING_BODY` | Request body is empty | Show validation error to user |
| `400` | `MISSING_REFRESH_TOKEN` | Refresh request missing `refreshToken` field | Code bug — fix request |
| `400` | `BAD_REQUEST` | Malformed request | Show generic error |
| `401` | `NO_TOKEN` | No `Authorization` header or not `Bearer` scheme | Redirect to login |
| `401` | `TOKEN_EXPIRED` | Access token has expired | Attempt refresh, then redirect to login |
| `401` | `INVALID_TOKEN` | JWT signature or claims invalid | Redirect to login |
| `401` | `TOKEN_VERSION_MISMATCH` | Token version != 1 (global invalidation) | Redirect to login |
| `401` | `INVALID_TOKEN_TYPE` | Used refresh token as access token (code bug) | Fix code |
| `401` | `TOKEN_REVOKED` | Token was revoked (logout, ban, etc.) | Redirect to login |
| `401` | `TOKEN_REPLAY_DETECTED` | Refresh token was reused | Clear all state, redirect to login |
| `401` | `USER_NOT_FOUND` | User deleted from DB | Clear all state, redirect to login |
| `401` | `PROOF_EXPIRED` | Exchange proof timestamp > 60s old | Retry exchange with fresh timestamp |
| `401` | `INVALID_PROOF` | HMAC signature mismatch | Check `NEXTAUTH_SECRET` matches |
| `401` | `SESSION_HIJACK_DETECTED` | Device fingerprint or IP changed suspiciously | Clear all state, redirect to login |
| `401` | `SESSION_TIMEOUT` | Inactivity (30 min) or absolute (7 day) timeout | Redirect to login |
| `401` | `NOT_AUTHENTICATED` | Auth middleware not applied or user not attached | Code bug — ensure `authenticate` middleware |
| `403` | `EMAIL_NOT_VERIFIED` | User's email is not verified | Show "verify your email" page |
| `403` | `ACCOUNT_BANNED` | User account is suspended | Show ban message, clear state |
| `403` | `FORBIDDEN` | User lacks required role/permission | Show "access denied" message |
| `403` | `CSRF_VALIDATION_FAILED` | Missing or invalid CSRF token | Re-fetch CSRF token, retry request |
| `404` | `NOT_FOUND` | Resource doesn't exist | Show "not found" page |
| `409` | `CONFLICT` | Duplicate resource | Show conflict message |
| `413` | `PAYLOAD_TOO_LARGE` | Request body > 10MB | Reduce payload size |
| `429` | `RATE_LIMIT_EXCEEDED` | Too many requests (per-user limit) | Wait for `retryAfter` seconds, retry |
| `429` | `REFRESH_IN_PROGRESS` | Concurrent refresh lock contention | Wait 1 second, retry refresh |
| `500` | `SESSION_ERROR` | Redis failure during session check | Retry request, show error if persistent |

### Error Response Shape

All errors follow this consistent structure:

```typescript
interface ErrorResponse {
  success: false;
  message: string;        // Human-readable message
  code: string;           // Machine-readable code (use this for logic)
  retryAfter?: number;    // Seconds to wait (only for 429)
  errors?: FieldError[];  // Validation errors (only for 400)
  required?: string[];    // Required permissions (only for 403 FORBIDDEN)
}

interface FieldError {
  field: string;
  message: string;
}
```

### Global Error Handler

```typescript
function handleAuthError(error: any): void {
  const status = error.response?.status;
  const code = error.response?.data?.code;

  if (!status) {
    // Network error
    showNotification("Network error. Please check your connection.", "error");
    return;
  }

  switch (status) {
    case 401:
      handle401(code);
      break;
    case 403:
      handle403(code);
      break;
    case 429:
      handle429(error.response.data.retryAfter);
      break;
    default:
      showNotification(error.response?.data?.message || "An error occurred", "error");
  }
}

function handle401(code: string): void {
  switch (code) {
    case "TOKEN_EXPIRED":
      // Will be handled by interceptor refresh attempt
      break;
    case "TOKEN_REVOKED":
    case "TOKEN_REPLAY_DETECTED":
    case "SESSION_HIJACK_DETECTED":
    case "USER_NOT_FOUND":
      clearAllAuthState();
      redirectToLogin();
      break;
    case "EMAIL_NOT_VERIFIED":
      redirectToVerifyEmail();
      break;
    case "ACCOUNT_BANNED":
      showAccountBannedMessage();
      clearAllAuthState();
      break;
    default:
      redirectToLogin();
  }
}

function handle403(code: string): void {
  switch (code) {
    case "CSRF_VALIDATION_FAILED":
      // Handled by interceptor — re-fetch CSRF and retry
      break;
    case "FORBIDDEN":
      showNotification("You don't have permission to perform this action.", "error");
      break;
    case "EMAIL_NOT_VERIFIED":
      redirectToVerifyEmail();
      break;
    case "ACCOUNT_BANNED":
      showAccountBannedMessage();
      break;
  }
}

function handle429(retryAfter: number): void {
  showNotification(`Rate limit exceeded. Please wait ${retryAfter} seconds.`, "warning");
}
```

---

## 10. Session Management

### Session Limits

| Parameter | Value |
|-----------|-------|
| Max concurrent sessions per user | **5** |
| Session TTL | **7 days** |
| Inactivity timeout | **30 minutes** |
| Absolute timeout | **7 days** |

### How Sessions Work

Each login creates a **session** with:
- A unique `sessionId` (UUID)
- A **device fingerprint** (SHA-256 hash of User-Agent + Accept-Language + Accept-Encoding)
- An **IP address**
- A **last activity** timestamp (updated on every request)

### Session Binding

The backend validates that each request comes from the same device and a reasonable IP:

| Check | Behavior |
|-------|----------|
| **Device fingerprint mismatch** | Always fails → `SESSION_HIJACK_DETECTED` → all refresh tokens revoked |
| **IP changed within 5 minutes** | Fails → `SESSION_HIJACK_DETECTED` |
| **IP changed after 5+ minutes idle** | Allowed (accommodates NAT, mobile networks) |

**Frontend implication:** Changing browsers or devices mid-session will invalidate the session. This is by design.

### Session Timeout Handling

```typescript
// The backend returns 401 with code "SESSION_TIMEOUT" when:
// - Inactivity timeout (30 min) exceeded
// - Absolute timeout (7 days) exceeded

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && 
        error.response?.data?.code === "SESSION_TIMEOUT") {
      showNotification("Your session has expired. Please log in again.", "info");
      clearAllAuthState();
      redirectToLogin();
    }
    return Promise.reject(error);
  }
);
```

### What Triggers Session Invalidation

| Event | Effect |
|-------|--------|
| User logs out | Current session revoked |
| User logs out from all devices | ALL sessions revoked |
| Device fingerprint changes | ALL refresh tokens revoked (hijack detection) |
| IP changes within 5 min | Current request rejected |
| 30 min inactivity | Session expires |
| 7 days absolute | Session expires |
| More than 5 concurrent sessions | Oldest session evicted |
| Account banned | All sessions invalid (cache invalidated) |

---

## 11. Rate Limiting

### Per-User API Rate Limits

| Tier | Requests per Minute |
|------|---------------------|
| Free | 60 |
| Pro | 300 |
| Enterprise | 1,000 |

### Rate Limit Headers

Every response includes these headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1719877443123
```

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Maximum requests per window for your tier |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp (ms) when the window resets |

### Handling Rate Limits

```typescript
function checkRateLimit(response: any): void {
  const remaining = parseInt(response.headers["x-ratelimit-remaining"]);
  const limit = parseInt(response.headers["x-ratelimit-limit"]);

  if (remaining < limit * 0.1) {
    // Less than 10% remaining — warn user or throttle requests
    console.warn(`Rate limit warning: ${remaining}/${limit} requests remaining`);
  }
}

// Handle 429 responses
async function handleRateLimit(error: any): Promise<void> {
  if (error.response?.status === 429) {
    const retryAfter = error.response.data.retryAfter || 60;
    showNotification(
      `Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`,
      "warning"
    );
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
  }
}
```

---

## 12. Token Storage Strategy

### Where to Store Tokens

| Storage | Security | Persistence | Recommended For |
|---------|----------|-------------|-----------------|
| **In-memory (React state/context)** | Best — inaccessible to XSS | Lost on page refresh | Access token |
| **localStorage** | Risky — accessible to XSS | Persists across refreshes | Avoid for tokens |
| **sessionStorage** | Moderate — tab-scoped | Lost on tab close | Acceptable fallback |
| **HTTP-only cookie** | Best — inaccessible to JS | Persists | NextAuth session only |

### Recommended Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    TOKEN STORAGE                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Access Token ──> React state / Context / Zustand           │
│                   (in-memory only, lost on refresh)         │
│                                                             │
│  Refresh Token ──> Managed by NextAuth (HTTP-only cookie)   │
│                    Frontend never touches this directly      │
│                                                             │
│  CSRF Token ────> React state / useRef                      │
│                   (in-memory, re-fetched on mount)          │
│                                                             │
│  NextAuth Session > HTTP-only cookie (auto-managed)         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Token Storage Manager

```typescript
// In-memory token storage (best security)
let accessToken: string | null = null;
let accessExpiry: number | null = null;
let csrfToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function storeAccessToken(token: string, expiry: number): void {
  accessToken = token;
  accessExpiry = expiry;
}

export function clearAccessToken(): void {
  accessToken = null;
  accessExpiry = null;
}

export function isTokenExpired(): boolean {
  if (!accessExpiry) return true;
  return Date.now() >= accessExpiry;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function storeCsrfToken(token: string): void {
  csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

export function clearAllAuthState(): void {
  clearAccessToken();
  clearCsrfToken();
  // Clear any other auth-related state
}
```

### Why In-Memory Is Better Than localStorage

| Scenario | localStorage | In-Memory |
|----------|-------------|-----------|
| XSS attack | Token stolen — attacker has full access | Token inaccessible to injected scripts |
| Browser extension | Extension can read localStorage | Extension cannot read JS variables |
| Shared computer | Token persists after logout (if not cleared) | Token gone when tab closes |
| Page refresh | Token survives — convenience | Token lost — must re-authenticate |

**Trade-off:** In-memory storage means the user must re-authenticate on page refresh. This is the security-first approach. If you need persistence, use `sessionStorage` as a fallback (still better than `localStorage`).

---

## 13. Security Do's and Don'ts

### Do's

| Rule | Reason |
|------|--------|
| **DO** use `Authorization: Bearer` header for all API calls | Standard, secure, not vulnerable to CSRF via cookies |
| **DO** fetch CSRF token before state-changing requests | Required by backend for POST/PUT/DELETE/PATCH |
| **DO** store tokens in memory only | Protects against XSS token theft |
| **DO** refresh token 1 minute before expiry | Prevents 401 errors during active use |
| **DO** handle `401` errors by attempting refresh first | Graceful degradation |
| **DO** clear all auth state on `TOKEN_REVOKED` or `SESSION_HIJACK_DETECTED` | Security incident — must re-authenticate |
| **DO** use `crypto.timingSafeEqual` equivalent when comparing tokens | Prevents timing attacks (backend handles this) |
| **DO** close SSE connections on component unmount | Prevents memory leaks and stale connections |
| **DO** reconnect SSE with new token after refresh | Old token may expire mid-connection |
| **DO** respect `retryAfter` in `429` responses | Avoids amplifying rate limit issues |
| **DO** send `Content-Type: application/json` on all POST/PUT/PATCH | Backend expects JSON body parsing |

### Don'ts

| Rule | Reason |
|------|--------|
| **DON'T** store access/refresh tokens in `localStorage` | Accessible to XSS — full account compromise |
| **DON'T** store tokens in regular cookies | Vulnerable to CSRF, no `httpOnly` protection |
| **DON'T** send refresh token as `Authorization: Bearer` | Refresh tokens go in request body only, never as Bearer |
| **DON'T** log tokens in console or analytics | Token leakage risk |
| **DON'T** include tokens in URL query strings (except SSE) | URL logged in server access logs, browser history, referrer headers |
| **DON'T** retry a `401 TOKEN_REPLAY_DETECTED` | The refresh token was reused — retrying makes it worse |
| **DON'T** retry a `401 TOKEN_REVOKED` | Token is blacklisted — retrying won't help |
| **DON'T** skip CSRF for POST/PUT/DELETE/PATCH | CSRF attacks can modify data without user knowledge |
| **DON'T** make multiple simultaneous refresh calls | Use a refresh lock/mutex in your code to prevent race conditions |
| **DON'T** ignore `429 RATE_LIMIT_EXCEEDED` | Retrying immediately makes the problem worse |
| **DON'T** hard-code tokens in source code | Tokens in code = tokens in git history = compromised |
| **DON'T** pass tokens to third-party scripts | Tokens should only go to your backend |
| **DON'T** store CSRF tokens in `localStorage` | In-memory only — CSRF tokens are short-lived (1hr) |
| **DON'T** assume GET requests need CSRF | Backend exempts safe methods from CSRF |
| **DON'T** use `withCredentials: true` for API calls | We use `Authorization` header, not cookies for API auth |

---

## 14. Environment Variables

### Frontend (Next.js)

```env
# Authentication
NEXTAUTH_SECRET=          # MUST match backend's NEXTAUTH_SECRET — used for HMAC exchange proof
NEXTAUTH_URL=             # Your deployment URL (e.g., https://focura.app)

# Backend connection
BACKEND_URL=              # Server-side only (NO NEXT_PUBLIC_ prefix) — for API routes and SSR
NEXT_PUBLIC_API_URL=      # Client-side — used for SSE connection and client API calls

# OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Redis (for rate limiting / session management)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Network
NODE_OPTIONS=--dns-result-order=ipv4first
```

### How Variables Connect

```
Frontend NEXTAUTH_SECRET ──────> Backend NEXTAUTH_SECRET
         │                              │
         │    (must be identical)        │
         │                              │
         ▼                              ▼
    HMAC signing ────────────────> HMAC verification
    (jwt callback)                (exchange endpoint)


Frontend BACKEND_URL ──────────> Backend base URL
         │                              │
         │    (server-side only)         │
         ▼                              ▼
    SSR API calls ──────────────> Express routes


Frontend NEXT_PUBLIC_API_URL ──> Backend base URL
         │                              │
         │    (client-side)              │
         ▼                              ▼
    SSE connections ────────────> /notifications/stream
    Client API calls ───────────> Express routes
```

### Critical Rule

`NEXTAUTH_SECRET` **must be identical** on both frontend and backend. If they don't match, every exchange request will fail with `INVALID_PROOF`.

---

## 15. Common Pitfalls & Troubleshooting

### Pitfall 1: Stale CSRF Token

**Symptom:** `403 CSRF_VALIDATION_FAILED` on POST requests

**Cause:** CSRF token expired (1-hour TTL) or session changed

**Fix:**

```typescript
// Re-fetch CSRF token on 403
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 && 
        error.response?.data?.code === "CSRF_VALIDATION_FAILED") {
      const newToken = await refreshCsrfToken();
      if (newToken) {
        error.config.headers["x-csrf-token"] = newToken;
        return api(error.config);
      }
    }
    return Promise.reject(error);
  }
);
```

### Pitfall 2: Token Expiry Race Condition

**Symptom:** `401 TOKEN_EXPIRED` even though you just refreshed

**Cause:** Multiple API calls in flight when token expired; some used the old token

**Fix:** Use a token refresh mutex to ensure only one refresh happens at a time:

```typescript
let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = doRefresh();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
```

### Pitfall 3: SSE Connection Dies After Token Refresh

**Symptom:** Notifications stop arriving after access token is refreshed

**Cause:** SSE connection was established with old token; new token not propagated

**Fix:** Reconnect SSE when token changes:

```typescript
useEffect(() => {
  if (!accessToken) return;

  const eventSource = connectSSE(accessToken, handleNotification);

  return () => {
    eventSource.close();
  };
}, [accessToken]); // Reconnect when token changes
```

### Pitfall 4: Exchange Proof Expired

**Symptom:** `401 PROOF_EXPIRED` on login

**Cause:** More than 60 seconds elapsed between proof generation and exchange request

**Fix:** Generate the proof immediately before the exchange call, not during NextAuth initialization:

```typescript
// BAD: Generate proof at module load time
const proof = buildExchangeProof(...); // May be stale when called

// GOOD: Generate proof at call time
async function exchangeTokens(user) {
  const proof = buildExchangeProof(user.id, user.email, user.role, crypto.randomUUID());
  const response = await fetch("/api/v1/auth/exchange", {
    method: "POST",
    body: JSON.stringify(proof),
  });
  return response.json();
}
```

### Pitfall 5: Session Binding Failure on Network Change

**Symptom:** `401 SESSION_HIJACK_DETECTED` after switching WiFi networks

**Cause:** IP changed within 5 minutes of last activity

**Fix:** This is expected behavior. The backend allows IP changes if the session was idle for 5+ minutes. If this happens:
1. Clear auth state
2. Redirect to login
3. Inform the user their session was invalidated for security

### Pitfall 6: Multiple Tabs Causing Refresh Wars

**Symptom:** `429 REFRESH_IN_PROGRESS` or `TOKEN_REPLAY_DETECTED` in other tabs

**Cause:** Multiple tabs try to refresh the same token simultaneously

**Fix:** Use `BroadcastChannel` to coordinate refresh across tabs:

```typescript
const authChannel = new BroadcastChannel("auth");

// Before refreshing, notify other tabs
async function coordinatedRefresh(): Promise<boolean> {
  // Check if another tab is already refreshing
  authChannel.postMessage({ type: "refresh-start" });
  return attemptTokenRefresh();
}

// Listen for refresh events from other tabs
authChannel.onmessage = async (event) => {
  if (event.data.type === "refresh-complete") {
    // Another tab refreshed successfully — update our tokens
    await fetchNewTokensFromServer();
  }
};
```

### Pitfall 7: Refresh Token Not Available in Client Code

**Symptom:** Can't call `/api/v1/auth/refresh` directly from client code

**Cause:** The refresh token lives in the NextAuth HTTP-only cookie — client JavaScript cannot access it

**Fix:** The refresh should be handled server-side in the NextAuth `jwt` callback. If you need to refresh from client code, create a Next.js API route that proxies the refresh call:

```typescript
// pages/api/auth/refresh.ts (Next.js API route)
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.refreshToken) return res.status(401).json({ error: "No session" });

  const response = await fetch(`${process.env.BACKEND_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
```

---

## 16. API Quick Reference

### Auth Endpoints (No Auth Required)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/v1/auth/exchange` | `{ userId, email, role, sessionId, timestamp, signature }` | `{ success, accessToken, refreshToken, accessTokenExpiry, refreshTokenExpiry }` |
| `POST` | `/api/v1/auth/refresh` | `{ refreshToken }` | `{ success, accessToken, refreshToken, accessTokenExpiry, refreshTokenExpiry }` |
| `POST` | `/api/v1/auth/logout` | `{ logoutAll? }` | `{ success, message }` |

### Auth Endpoints (Auth Required)

| Method | Path | Headers | Response |
|--------|------|---------|----------|
| `GET` | `/api/v1/csrf-token` | `Authorization: Bearer <token>` | `{ success, data: { csrfToken, expiresIn } }` |

### Protected Endpoints (Auth + CSRF Required)

| Method | Path | Headers | Body |
|--------|------|---------|------|
| `GET` | `/api/v1/user/profile` | `Authorization: Bearer` | — |
| `PUT` | `/api/v1/user/profile` | `Authorization: Bearer`, `x-csrf-token` | `{ name?, bio?, image?, timezone? }` |
| `GET` | `/api/v1/user/workspace-members` | `Authorization: Bearer` | — |

### SSE Endpoint

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/v1/notifications/stream?token=<accessToken>` | Query param |

### Complete Header Reference

```
Authorization: Bearer <accessToken>        # Required for all authenticated endpoints
x-csrf-token: <csrfToken>                 # Required for POST/PUT/DELETE/PATCH
Content-Type: application/json            # Required for request bodies
x-show-error-toast: true                  # Optional — frontend hint to show error toast
x-show-success-toast: true                # Optional — frontend hint to show success toast
```

---

## Summary: Quick Checklist

Before shipping any auth-related feature, verify:

- [ ] Access token stored in memory only (not `localStorage`)
- [ ] CSRF token fetched before state-changing requests
- [ ] CSRF token sent via `x-csrf-token` header (not cookie/body)
- [ ] `401` errors trigger refresh attempt before redirect
- [ ] `TOKEN_REPLAY_DETECTED` and `TOKEN_REVOKED` cause immediate logout
- [ ] SSE connections closed on component unmount
- [ ] SSE reconnection uses new token after refresh
- [ ] Refresh uses a mutex to prevent concurrent calls
- [ ] `429` responses respect `retryAfter` delay
- [ ] Exchange proof generated immediately before the call (not cached)
- [ ] All auth state cleared on logout
- [ ] `NEXTAUTH_SECRET` matches between frontend and backend
