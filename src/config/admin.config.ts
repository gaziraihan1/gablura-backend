// Focura admins — hardcoded user IDs from env
export function getFocuraAdminIds(): string[] {
  const raw = process.env.FOCURA_ADMIN_IDS ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isFocuraAdmin(userId: string): boolean {
  return getFocuraAdminIds().includes(userId);
}

/**
 * A user is a Focura admin only when BOTH their DB role is ADMIN AND their id
 * is registered in `FOCURA_ADMIN_IDS`. Single predicate backing both the admin
 * API guard (`requireFocuraAdmin`) and the client-facing `admin/me` check, so
 * the frontend gate can never report "admin" while the admin APIs reject (403).
 */
export function isFocuraAdminUser(
  role: string | undefined,
  userId: string | undefined,
): boolean {
  return Boolean(userId) && role === 'ADMIN' && isFocuraAdmin(userId!);
}
