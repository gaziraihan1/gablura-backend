// backend/src/billing/service/plans.config.ts

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

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
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;