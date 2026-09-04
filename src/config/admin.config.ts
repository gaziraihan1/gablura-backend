// Gablura admins — hardcoded user IDs from env
export function getGabluraAdminIds(): string[] {
  const raw = process.env.GABLURA_ADMIN_IDS ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isGabluraAdmin(userId: string): boolean {
  return getGabluraAdminIds().includes(userId);
}

/**
 * A user is a Gablura admin only when BOTH their DB role is ADMIN AND their id
 * is registered in `GABLURA_ADMIN_IDS`. Single predicate backing both the admin
 * API guard (`requireGabluraAdmin`) and the client-facing `admin/me` check, so
 * the frontend gate can never report "admin" while the admin APIs reject (403).
 */
export function isGabluraAdminUser(
  role: string | undefined,
  userId: string | undefined,
): boolean {
  return Boolean(userId) && role === 'ADMIN' && isGabluraAdmin(userId!);
}
