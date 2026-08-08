import { generateSecret as otpGenerateSecret, generateURI, verify as otpVerify } from 'otplib';

const ISSUER = 'Focura';

export function generateTOTPSecret(): string {
  return otpGenerateSecret();
}

export function createTOTPURI(secret: string, email: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

export async function verifyTOTPToken(token: string, secret: string): Promise<boolean> {
  try {
    const result = await otpVerify({ token, secret });
    // otplib v13 returns `{ valid: true, delta }` / `{ valid: false }` objects
    // (truthy either way — returning them directly would accept invalid
    // codes), while older versions returned a plain boolean. Normalize both
    // so a library upgrade can never silently accept or reject codes.
    const normalized = result as unknown as boolean | { valid: boolean };
    if (typeof normalized === "boolean") {
      return normalized;
    }
    return normalized.valid === true;
  } catch {
    return false;
  }
}
