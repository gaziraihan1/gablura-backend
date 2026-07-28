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
    return await otpVerify({ token, secret });
  } catch {
    return false;
  }
}
