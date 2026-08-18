// backend/src/billing/service/plans.config.ts

// Base URL of the frontend, used to build checkout success/cancel URLs and the
// customer portal return URL. Resolution order matches the rest of the codebase
// (CLIENT_URL is the convention used by CORS, emails, and OAuth redirects):
//   CLIENT_URL -> APP_URL -> NEXT_PUBLIC_APP_URL -> FRONTEND_URL -> localhost
// NOTE: `.env` defines APP_URL; the previous code only read NEXT_PUBLIC_APP_URL,
// so checkout redirects silently pointed at http://localhost:3000 in prod.
export const APP_URL =
  process.env.CLIENT_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.FRONTEND_URL ||
  'http://localhost:3000';

export const PLAN_LIMITS = {
  FREE: {
    maxWorkspacesOwned: 1,
    maxMembersPerWs:    5,
    maxStorageMb:       1024,
    maxFileSizeMb:      5,
    maxMeetingsPerMo:   10,
    maxProjects:        3,
    analyticsAccess:    false,
    businessOnlyAccess: false,
    prioritySupport:    false,
    apiAccess:          false,
  },
  PRO: {
    maxWorkspacesOwned: 3,
    maxMembersPerWs:    25,
    maxStorageMb:       10_240,
    maxFileSizeMb:      25,
    maxMeetingsPerMo:   -1,
    maxProjects:        -1,
    analyticsAccess:    true,
    businessOnlyAccess: false,
    prioritySupport:    false,
    apiAccess:          false,
  },
  BUSINESS: {
    maxWorkspacesOwned: -1,
    maxMembersPerWs:    -1,
    maxStorageMb:       102_400,
    maxFileSizeMb:      100,
    maxMeetingsPerMo:   -1,
    maxProjects:        -1,
    analyticsAccess:    true,
    businessOnlyAccess: true,
    prioritySupport:    true,
    apiAccess:          true,
  },
  ENTERPRISE: {
    // Top tier — BUSINESS allowances with unlimited storage, matching the
    // workspaceUsage PLAN_LIMITS (storage: -1) and PLAN_RANK (3). Without this
    // entry ENTERPRISE workspaces silently fell back to FREE limits everywhere
    // (`PLAN_LIMITS[name] ?? PLAN_LIMITS.FREE`).
    maxWorkspacesOwned: -1,
    maxMembersPerWs:    -1,
    maxStorageMb:       -1,
    maxFileSizeMb:      100,
    maxMeetingsPerMo:   -1,
    maxProjects:        -1,
    analyticsAccess:    true,
    businessOnlyAccess: true,
    prioritySupport:    true,
    apiAccess:          true,
  },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;