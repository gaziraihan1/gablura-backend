
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const ACCESS_TOKEN_EXPIRY = "15m";
export const REFRESH_TOKEN_EXPIRY = "7d";
export const SSE_TOKEN_EXPIRY = "30s";

export const CURRENT_TOKEN_VERSION = 1;

let privateKey: string;
let publicKey: string;

try {
  console.log("KEY ENV CHECK:", {
  hasPrivate: !!process.env.JWT_PRIVATE_KEY,
  hasPublic: !!process.env.JWT_PUBLIC_KEY,
  privateSample: process.env.JWT_PRIVATE_KEY?.slice(0, 20),
});
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
    privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY, "base64").toString(
      "utf-8",
    );
    publicKey = Buffer.from(process.env.JWT_PUBLIC_KEY, "base64").toString(
      "utf-8",
    );
  } else {
    const keysDir = path.join(process.cwd(), "keys");
    privateKey = fs.readFileSync(
      process.env.JWT_PRIVATE_KEY_PATH || path.join(keysDir, "private.pem"),
      "utf-8",
    );
    publicKey = fs.readFileSync(
      process.env.JWT_PUBLIC_KEY_PATH || path.join(keysDir, "public.pem"),
      "utf-8",
    );
  }
} catch (error) {
  console.error("❌ Failed to load JWT keys:", error);
}

export interface TokenPayload {
  id: string;
  email: string;
  role: string;
  type: "access" | "refresh" | "sse" ;
  version: number;
  jti: string;
  sessionId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: number;
  refreshTokenExpiry: number;
}

export function createAccessToken(p: {
  id: string;
  email: string;
  role: string;
  sessionId: string;
}): string {
  return jwt.sign(
    {
      sub: p.id,
      email: p.email,
      role: p.role,
      type: "access",
      version: CURRENT_TOKEN_VERSION,
      jti: crypto.randomUUID(),
      sessionId: p.sessionId,
    },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: "focura-app",
      audience: "focura-backend",
    },
  );
}

export function createRefreshToken(p: {
  id: string;
  email: string;
  role: string;
  sessionId: string;
}): string {
  return jwt.sign(
    {
      sub: p.id,
      email: p.email,
      role: p.role,
      type: "refresh",
      version: CURRENT_TOKEN_VERSION,
      jti: crypto.randomUUID(),
      sessionId: p.sessionId,
    },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: REFRESH_TOKEN_EXPIRY,
      issuer: "focura-app",
      audience: "focura-backend",
    },
  );
}

export function createTokenPair(p: {
  id: string;
  email: string;
  role: string;
  sessionId?: string;
}): TokenPair {
  const sessionId = p.sessionId || crypto.randomUUID();
  const payload = { ...p, sessionId };
  return {
    accessToken: createAccessToken(payload),
    refreshToken: createRefreshToken(payload),
    accessTokenExpiry: Date.now() + parseExpiry(ACCESS_TOKEN_EXPIRY),
    refreshTokenExpiry: Date.now() + parseExpiry(REFRESH_TOKEN_EXPIRY),
  };
}

export function createSseToken(userId: string): string {
  return jwt.sign(
    {
      sub: userId,
      type: "sse",
      version: CURRENT_TOKEN_VERSION,
      jti: crypto.randomUUID(),
    },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: SSE_TOKEN_EXPIRY,
      issuer: "focura-app",
      audience: "focura-backend",
    },
  );
}

export function verifyToken(
  token: string,
  expectedType?: TokenPayload["type"],
  audience = "focura-backend",
): TokenPayload {
  const decoded = jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: "focura-app",
    audience,
  }) as jwt.JwtPayload;

  if (decoded.version !== CURRENT_TOKEN_VERSION)
    throw new Error("Token version mismatch");
  if (expectedType && decoded.type !== expectedType)
    throw new Error(`Expected '${expectedType}', got '${decoded.type}'`);

  return {
    id: decoded.sub!,
    email: decoded.email,
    role: decoded.role,
    type: decoded.type,
    version: decoded.version,
    jti: decoded.jti!,
    sessionId: decoded.sessionId, // Support both 'sid' and 'sessionId' for backward compatibility
  };
}

export function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry: ${expiry}`);
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
  };
  return parseInt(match[1], 10) * multipliers[match[2]];
}

export function extractJti(token: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf-8"),
    );
    return payload.jti ?? "";
  } catch {
    return "";
  }
}
