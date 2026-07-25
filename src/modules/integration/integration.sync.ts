import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../redis/redis.client.js';
import { addSyncIntegrationJob } from '../../queue/queues/integration.queue.js';
import { getValidAccessToken } from './integration.oauth.js';
import type { IntegrationConfig, SyncStatus } from './integration.types.js';

// ─── Sync Functions ───────────────────────────────────────────────────────────

/**
 * Trigger manual sync
 */
export async function triggerSync(integrationId: string, userId: string) {
  const { IntegrationAccess } = await import('./integration.access.js');
  await IntegrationAccess.enforceCanView(integrationId, userId);

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration) {
    const { NotFoundError } = await import('../../errors/index.js');
    throw new NotFoundError('Integration');
  }

  // Update sync status to pending
  const currentSyncStatus = integration.syncStatus as SyncStatus | null;
  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      syncStatus: {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'pending',
        syncCount: (currentSyncStatus?.syncCount || 0) + 1,
      },
    },
  });

  // Add to job queue for actual sync
  const syncId = crypto.randomUUID();
  await addSyncIntegrationJob({ integrationId, userId });

  return { syncId };
}

/**
 * Perform the actual sync (called by worker)
 */
export async function performSync(integrationId: string) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || !integration.active) {
    console.error(`Integration ${integrationId} not found or inactive`);
    return;
  }

  try {
    const accessToken = await getValidAccessToken(integrationId);
    if (!accessToken) {
      throw new Error('No valid access token');
    }

    // Perform provider-specific sync
    switch (integration.provider) {
      case 'github':
        await syncGithubData(integration, accessToken);
        break;
      case 'slack':
        await syncSlackData(integration, accessToken);
        break;
      case 'google-calendar':
        await syncGoogleCalendarData(integration, accessToken);
        break;
      case 'trello':
        await syncTrelloData(integration, accessToken);
        break;
    }

    // Update sync status to success
    const syncStatus = integration.syncStatus as SyncStatus;
    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        syncStatus: {
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'success',
          syncCount: (syncStatus?.syncCount || 0) + 1,
        },
      },
    });

    console.log(`Sync completed for integration ${integrationId}`);
  } catch (error) {
    console.error(`Sync failed for integration ${integrationId}:`, error);

    // Update sync status to failed
    const syncStatus = integration.syncStatus as SyncStatus;
    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        syncStatus: {
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'failed',
          syncCount: (syncStatus?.syncCount || 0) + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });
  }
}

// ─── Provider-Specific Sync ──────────────────────────────────────────────────

/**
 * Sync GitHub data (repositories, issues, PRs)
 */
async function syncGithubData(integration: { id: string; config: unknown }, accessToken: string) {
  const config = integration.config as IntegrationConfig;
  const selectedRepos = config?.selectedRepos || [];

  if (selectedRepos.length === 0) {
    console.log('No repos selected for GitHub sync');
    return;
  }

  for (const repoFullName of selectedRepos) {
    const [owner, repoName] = repoFullName.split('/');

    // Fetch open issues
    const issuesResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/issues?state=open&per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );

    if (issuesResponse.ok) {
      const issues = await issuesResponse.json() as any[];
      console.log(`Fetched ${issues.length} issues from ${repoFullName}`);

      // Store issues for later processing
      const redis = getRedisClient();
      await redis.setex(
        `integration:github:${integration.id}:issues:${repoFullName}`,
        3600,
        JSON.stringify(issues)
      );
    }
  }
}

/**
 * Sync Slack data (channels, messages)
 */
async function syncSlackData(integration: { id: string; config: unknown }, accessToken: string) {
  const config = integration.config as IntegrationConfig;
  const selectedChannels = config?.selectedChannels || [];

  if (selectedChannels.length === 0) {
    console.log('No channels selected for Slack sync');
    return;
  }

  for (const channelId of selectedChannels) {
    // Fetch recent messages
    const messagesResponse = await fetch(
      `https://slack.com/api/conversations.history?channel=${channelId}&limit=100`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (messagesResponse.ok) {
      const data = await messagesResponse.json() as any;
      if (data.ok && data.messages) {
        console.log(`Fetched ${data.messages.length} messages from channel ${channelId}`);

        // Store messages for later processing
        const redis = getRedisClient();
        await redis.setex(
          `integration:slack:${integration.id}:messages:${channelId}`,
          3600,
          JSON.stringify(data.messages)
        );
      }
    }
  }
}

/**
 * Sync Google Calendar data (events)
 */
async function syncGoogleCalendarData(integration: { id: string }, accessToken: string) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch calendar events
  const eventsResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=100&singleEvents=true&orderBy=startTime`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  if (eventsResponse.ok) {
    const data = await eventsResponse.json() as any;
    const events = data.items || [];
    console.log(`Fetched ${events.length} calendar events`);

    // Store events for later processing
    const redis = getRedisClient();
    await redis.setex(
      `integration:google-calendar:${integration.id}:events`,
      3600,
      JSON.stringify(events)
    );
  }
}

/**
 * Sync Trello data (boards, cards)
 */
async function syncTrelloData(integration: { id: string }, accessToken: string) {
  // Fetch user's boards
  const boardsResponse = await fetch(
    `https://api.trello.com/1/members/me/boards?key=${process.env.TRELLO_CLIENT_ID}&token=${accessToken}&fields=name,url`,
  );

  if (boardsResponse.ok) {
    const boards = await boardsResponse.json() as any[];
    console.log(`Fetched ${boards.length} Trello boards`);

    // Store boards for later processing
    const redis = getRedisClient();
    await redis.setex(
      `integration:trello:${integration.id}:boards`,
      3600,
      JSON.stringify(boards)
    );
  }
}
