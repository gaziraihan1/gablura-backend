import { z } from 'zod';

// ─── Provider Enum ────────────────────────────────────────────────────────────

const providerEnum = z.enum(['github', 'slack', 'google-calendar', 'trello']);

// ─── Create Integration ───────────────────────────────────────────────────────

export const createIntegrationSchema = z.object({
  provider: providerEnum,
  workspaceId: z.string().optional(),
});

// ─── OAuth Callback ───────────────────────────────────────────────────────────

export const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State parameter is required'),
  provider: providerEnum,
  redirectUri: z.string().url('Invalid redirect URI'),
});

// ─── Update Integration Config ────────────────────────────────────────────────

export const updateIntegrationConfigSchema = z.object({
  config: z.object({
    workspaceId: z.string().optional(),
    syncDirection: z.enum(['one-way', 'two-way']).optional(),
    autoSync: z.boolean().optional(),
    syncInterval: z.number().min(60).max(86400).optional(), // 1 min to 24 hours
    notifications: z.boolean().optional(),
    notificationChannel: z.string().optional(),
    notifyMembers: z.boolean().optional(),
    allowedMembers: z.array(z.string()).optional(),
    selectedChannels: z.array(z.string()).optional(),
    selectedRepos: z.array(z.string()).optional(),
    projectMapping: z.record(z.string(), z.string()).optional(),
  }),
});

// ─── Query Schemas ────────────────────────────────────────────────────────────

export const getIntegrationParamsSchema = z.object({
  id: z.string().min(1, 'Integration ID is required'),
});

export const workspaceIntegrationParamsSchema = z.object({
  slug: z.string().min(1, 'Workspace slug is required'),
});

export const workspaceIntegrationBodySchema = z.object({
  provider: providerEnum,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;
export type UpdateIntegrationConfigInput = z.infer<typeof updateIntegrationConfigSchema>;
