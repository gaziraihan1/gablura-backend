import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../redis/redis.client.js';
import { ValidationError } from '../../errors/index.js';
import type { IntegrationProvider, OAuthTokens } from './integration.types.js';

// ─── Internal Types ───────────────────────────────────────────────────────────

export interface OAuthStateData {
  provider: IntegrationProvider;
  userId: string;
  workspaceId?: string;
  csrfToken: string;
  timestamp: number;
}

// ─── Provider Configurations ──────────────────────────────────────────────────

export const PROVIDER_CONFIG: Record<IntegrationProvider, { name: string; authUrl: string; tokenUrl: string; scopes: string[] }> = {
  github: {
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user'],
  },
  slack: {
    name: 'Slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['channels:read', 'chat:write', 'commands'],
  },
  'google-calendar': {
    name: 'Google Calendar',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
  },
  trello: {
    name: 'Trello',
    authUrl: 'https://trello.com/1/authorize',
    tokenUrl: 'https://trello.com/1/oauth/token',
    scopes: ['read,write'],
  },
};

// ─── OAuth Functions ─────────────────────────────────────────────────────────

/**
 * Generate OAuth authorization URL
 */
export async function generateAuthUrl(
  provider: IntegrationProvider,
  userId: string,
  workspaceId?: string,
): Promise<string> {
  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    throw new ValidationError(`Unsupported provider: ${provider}`);
  }

  const clientId = process.env[`${provider.toUpperCase().replace('-', '_')}_CLIENT_ID`];
  if (!clientId) {
    throw new Error(`Missing client ID for provider: ${provider}`);
  }

  const frontendUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const redirectUri = `${frontendUrl}/dashboard/integrations/callback`;

  // Generate CSRF token
  const csrfToken = crypto.randomBytes(32).toString('hex');

  // Store CSRF token in Redis (with 10 min expiry)
  const redis = getRedisClient();
  const redisKey = `integration_csrf:${userId}:${csrfToken}`;

  try {
    await redis.setex(redisKey, 600, csrfToken);
    // Verify the token was actually stored
    const verifyToken = await redis.get(redisKey);
    if (!verifyToken) {
      console.error('CSRF token storage verification failed - token not found after setex');
      throw new Error('Failed to create integration session. Please try again.');
    }
    console.log('Integration CSRF token stored successfully:', {
      userId,
      redisKey,
      csrfTokenLength: csrfToken.length,
    });
  } catch (redisError) {
    console.error('Failed to store integration CSRF token in Redis:', redisError);
    throw new Error('Failed to create integration session. Please try again.', { cause: redisError });
  }

  const state = JSON.stringify({
    provider,
    userId,
    workspaceId,
    csrfToken,
    timestamp: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state: Buffer.from(state).toString('base64'),
    response_type: 'code',
  });

  // Provider-specific params
  if (provider === 'github') {
    params.set('allow_signup', 'true');
  } else if (provider === 'slack') {
    params.set('user_scope', 'identity.basic');
  } else if (provider === 'google-calendar') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  return `${config.authUrl}?${params.toString()}`;
}

/**
 * Exchange OAuth code for tokens and create/update integration
 */
export async function handleOAuthCallback(
  code: string,
  state: string,
  userId: string,
) {
  // Parse state
  let stateData: OAuthStateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString());
  } catch {
    throw new ValidationError('Invalid state parameter');
  }

  const { provider, workspaceId, timestamp, csrfToken } = stateData;

  console.log('OAuth callback state parsed:', {
    provider,
    hasWorkspaceId: !!workspaceId,
    hasCsrfToken: !!csrfToken,
    stateUserId: stateData.userId,
    requestUserId: userId,
    timestampAge: Date.now() - timestamp,
  });

  // Validate state freshness (10 min max)
  if (Date.now() - timestamp > 10 * 60 * 1000) {
    throw new ValidationError('OAuth state has expired. Please try again.');
  }

  // Verify user matches
  if (stateData.userId !== userId) {
    console.error('OAuth callback user mismatch:', {
      stateUserId: stateData.userId,
      requestUserId: userId,
    });
    throw new ValidationError('User mismatch in OAuth state');
  }

  // Verify CSRF token from Redis
  if (csrfToken) {
    const redis = getRedisClient();
    const redisKey = `integration_csrf:${userId}:${csrfToken}`;

    try {
      const storedToken = await redis.get(redisKey);
      if (!storedToken) {
        // Check if Redis is connected
        const isConnected = redis.status === 'ready';
        console.error('Integration CSRF token not found in Redis:', {
          userId,
          redisKey,
          csrfTokenLength: csrfToken.length,
          redisConnected: isConnected,
          redisStatus: redis.status,
        });
        throw new ValidationError('Invalid CSRF token. Please try again.');
      }
      // Delete the token (one-time use)
      await redis.del(redisKey);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      console.error('Redis error during CSRF validation:', error);
      throw new ValidationError('Failed to validate integration. Please try again.');
    }
  }

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(provider, code);

  // Get provider name
  const providerConfig = PROVIDER_CONFIG[provider];
  const providerName = providerConfig?.name || provider;

  // Check if integration already exists
  const existingIntegration = workspaceId
    ? await prisma.integration.findFirst({
        where: {
          workspaceId,
          provider,
        },
      })
    : await prisma.integration.findFirst({
        where: {
          userId,
          provider,
          workspaceId: null,
        },
      });

  if (existingIntegration) {
    // Update existing integration
    return prisma.integration.update({
      where: { id: existingIntegration.id },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        active: true,
        connectedAt: new Date(),
        syncStatus: { lastSyncAt: null, lastSyncStatus: 'pending', syncCount: 0 },
      },
    });
  }

  // Create new integration
  return prisma.integration.create({
    data: {
      name: providerName,
      provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      active: true,
      connectedAt: new Date(),
      userId: workspaceId ? null : userId,
      workspaceId: workspaceId || null,
      connectedById: userId,
      config: {
        syncDirection: 'one-way',
        autoSync: true,
        syncInterval: 300,
        notifications: true,
      },
      syncStatus: { lastSyncAt: null, lastSyncStatus: 'pending', syncCount: 0 },
    },
  });
}

/**
 * Exchange authorization code for access/refresh tokens
 */
export async function exchangeCodeForTokens(
  provider: IntegrationProvider,
  code: string,
): Promise<OAuthTokens> {
  const clientId = process.env[`${provider.toUpperCase().replace('-', '_')}_CLIENT_ID`];
  const clientSecret = process.env[`${provider.toUpperCase().replace('-', '_')}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    throw new Error(`Missing credentials for provider: ${provider}`);
  }

  const frontendUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const redirectUri = `${frontendUrl}/dashboard/integrations/callback`;

  // Different token exchange flows per provider
  switch (provider) {
    case 'github':
      return exchangeGithubCode(code, clientId, clientSecret);
    case 'slack':
      return exchangeSlackCode(code, clientId, clientSecret, redirectUri);
    case 'google-calendar':
      return exchangeGoogleCode(code, clientId, clientSecret, redirectUri);
    case 'trello':
      return exchangeTrelloCode(code, clientId, clientSecret);
    default:
      throw new ValidationError(`Unsupported provider: ${provider}`);
  }
}

async function exchangeGithubCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = await response.json() as Record<string, any>;

  if (data.error) {
    throw new ValidationError(`GitHub OAuth error: ${data.error_description}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    scope: data.scope,
  };
}

async function exchangeSlackCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const data = await response.json() as Record<string, any>;

  if (!data.ok) {
    throw new ValidationError(`Slack OAuth error: ${data.error}`);
  }

  return {
    accessToken: data.access_token,
    // Slack doesn't provide refresh tokens for bot tokens
    scope: data.scope,
  };
}

async function exchangeGoogleCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const data = await response.json() as Record<string, any>;

  if (data.error) {
    throw new ValidationError(`Google OAuth error: ${data.error_description}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    scope: data.scope,
  };
}

async function exchangeTrelloCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const response = await fetch('https://trello.com/1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  const data = await response.json() as Record<string, any>;

  if (data.error) {
    throw new ValidationError(`Trello OAuth error: ${data.error}`);
  }

  return {
    accessToken: data.access_token,
    // Trello tokens don't expire
  };
}

// ─── Token Management ────────────────────────────────────────────────────────

/**
 * Revoke tokens with the provider
 */
export async function revokeProviderTokens(provider: string, accessToken: string | null) {
  if (!accessToken) return;

  switch (provider) {
    case 'github':
      await fetch(`https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/token`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString('base64')}`,
          'Accept': 'application/vnd.github+json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
      break;
    case 'slack':
      // Slack tokens are revoked via API
      await fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: accessToken,
        }).toString(),
      });
      break;
    // Google and Trello don't require explicit revocation
  }
}

/**
 * Refresh an expired access token
 */
export async function refreshToken(integrationId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || !integration.refreshToken) {
    return null;
  }

  // Check if token is still valid
  if (integration.expiresAt && integration.expiresAt > new Date()) {
    return integration.accessToken;
  }

  try {
    const clientId = process.env[`${integration.provider.toUpperCase().replace('-', '_')}_CLIENT_ID`];
    const clientSecret = process.env[`${integration.provider.toUpperCase().replace('-', '_')}_CLIENT_SECRET`];

    if (!clientId || !clientSecret) {
      throw new Error(`Missing credentials for provider: ${integration.provider}`);
    }

    let newTokens: OAuthTokens | null = null;

    switch (integration.provider) {
      case 'github':
        // GitHub tokens don't expire, but we refresh if needed
        newTokens = await refreshGithubToken(integration.refreshToken, clientId, clientSecret);
        break;
      case 'google-calendar':
        newTokens = await refreshGoogleToken(integration.refreshToken, clientId, clientSecret);
        break;
      // Slack and Trello tokens don't refresh
    }

    if (newTokens) {
      await prisma.integration.update({
        where: { id: integrationId },
        data: {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken || integration.refreshToken,
          expiresAt: newTokens.expiresAt,
        },
      });
      return newTokens.accessToken;
    }

    return integration.accessToken;
  } catch (error) {
    console.error(`Failed to refresh token for integration ${integrationId}:`, error);
    return null;
  }
}

async function refreshGithubToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  // GitHub doesn't use refresh tokens in the traditional sense
  // But we can exchange the refresh token for a new access token
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json() as Record<string, any>;

  if (data.error) {
    throw new ValidationError(`GitHub token refresh error: ${data.error_description}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const data = await response.json() as Record<string, any>;

  if (data.error) {
    throw new ValidationError(`Google token refresh error: ${data.error_description}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

/**
 * Get a valid access token (refresh if needed)
 */
export async function getValidAccessToken(integrationId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || !integration.accessToken) {
    return null;
  }

  // Check if token needs refresh
  if (integration.expiresAt && integration.expiresAt <= new Date()) {
    return refreshToken(integrationId);
  }

  return integration.accessToken;
}
