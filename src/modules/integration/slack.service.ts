import { prisma } from '../../lib/prisma.js';
import { getValidAccessToken } from './integration.oauth.js';
import type {
  SlackUser,
  SlackChannel,
  SlackMessage,
  SlackApiResponse,
  SlackConversationsListResponse,
  SlackUsersListResponse,
  SlackPostMessageResponse,
} from './slack.types.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const SLACK_API_BASE = 'https://slack.com/api';

const REQUEST_TIMEOUT_MS = 15_000;

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function slackFetch<T extends SlackApiResponse>(
  path: string,
  options: {
    method?: string;
    token: string;
    body?: Record<string, unknown>;
    contentType?: string;
  },
): Promise<T> {
  const { method = 'GET', token, body, contentType } = options;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (body) {
    if (contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      fetchOptions.body = params.toString();
    } else {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      fetchOptions.body = JSON.stringify(body);
    }
  }

  const response = await fetch(`${SLACK_API_BASE}${path}`, fetchOptions);
  const data = (await response.json()) as T;

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error} (${path})`);
  }

  return data;
}

// ─── Slack Service ───────────────────────────────────────────────────────────

export class SlackService {
  private readonly integrationId: string;

  constructor(integrationId: string) {
    this.integrationId = integrationId;
  }

  /**
   * Get a valid access token for Slack API calls
   */
  private async getToken(): Promise<string> {
    const token = await getValidAccessToken(this.integrationId);
    if (!token) {
      throw new Error('No valid Slack access token available');
    }
    return token;
  }

  // ─── Channels ────────────────────────────────────────────────────────────

  /**
   * List all public channels in the workspace
   */
  async listChannels(cursor?: string): Promise<{ channels: SlackChannel[]; nextCursor?: string }> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);

    const data = await slackFetch<SlackConversationsListResponse>(
      `/conversations.list?${params.toString()}`,
      { token },
    );

    const channelsData = data as unknown as SlackConversationsListResponse;
    return {
      channels: channelsData.channels,
      nextCursor: channelsData.response_metadata?.next_cursor,
    };
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channelId: string): Promise<SlackChannel | null> {
    const token = await this.getToken();
    try {
      const data = await slackFetch<any>(
        `/conversations.info?channel=${channelId}`,
        { token },
      );
      if (!data.channel) return null;
      const ch = data.channel as any;
      return {
        id: ch.id,
        name: ch.name,
        isChannel: ch.is_channel,
        isGroup: ch.is_group,
        isIM: ch.is_im,
        isMember: ch.is_member,
        topic: ch.topic?.value,
        purpose: ch.purpose?.value,
        memberCount: ch.num_members,
      };
    } catch {
      return null;
    }
  }

  // ─── Users ───────────────────────────────────────────────────────────────

  /**
   * List all users in the workspace
   */
  async listUsers(cursor?: string): Promise<{ users: SlackUser[]; nextCursor?: string }> {
    const token = await this.getToken();
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);

    const data = await slackFetch<SlackUsersListResponse>(
      `/users.list?${params.toString()}`,
      { token },
    );

    const members = (data.members || []).map((m: any) => ({
      id: m.id,
      teamId: m.team_id,
      name: m.name,
      realName: m.real_name,
      displayName: m.profile?.display_name || m.profile?.real_name,
      email: m.profile?.email,
      avatarUrl: m.profile?.image_192 || m.profile?.image_72,
    }));

    const meta = data as any;
    return {
      users: members,
      nextCursor: meta.response_metadata?.next_cursor,
    };
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<SlackUser | null> {
    const token = await this.getToken();
    try {
      const data = await slackFetch<any>(`/users.info?user=${userId}`, { token });
      if (!data.user) return null;
      const u = data.user;
      return {
        id: u.id,
        teamId: u.team_id,
        name: u.name,
        realName: u.real_name,
        displayName: u.profile?.display_name || u.profile?.real_name,
        email: u.profile?.email,
        avatarUrl: u.profile?.image_192 || u.profile?.image_72,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve Slack user to Focura user (by email)
   */
  async resolveSlackUserToFocuraUserId(slackUserId: string): Promise<string | null> {
    const slackUser = await this.getUserInfo(slackUserId);
    if (!slackUser?.email) return null;

    const focuraUser = await prisma.user.findUnique({
      where: { email: slackUser.email },
      select: { id: true },
    });

    return focuraUser?.id || null;
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  /**
   * Get message permalink
   */
  async getMessagePermalink(channelId: string, messageTs: string): Promise<string | null> {
    const token = await this.getToken();
    try {
      const data = await slackFetch<any>(
        `/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`,
        { token },
      );
      return data.permalink || null;
    } catch {
      return null;
    }
  }

  /**
   * Post a message to a channel
   */
  async postMessage(options: {
    channel: string;
    text: string;
    blocks?: unknown[];
    threadTs?: string;
    mrkdwn?: boolean;
    unfurlLinks?: boolean;
  }): Promise<SlackPostMessageResponse | null> {
    const token = await this.getToken();
    try {
      const body: Record<string, unknown> = {
        channel: options.channel,
        text: options.text,
        mrkdwn: options.mrkdwn ?? true,
        unfurl_links: options.unfurlLinks ?? false,
      };

      if (options.blocks) body.blocks = options.blocks;
      if (options.threadTs) body.thread_ts = options.threadTs;

      return await slackFetch<SlackPostMessageResponse>('/chat.postMessage', {
        method: 'POST',
        token,
        body,
      });
    } catch (error) {
      console.error('[SlackService] Failed to post message:', error);
      return null;
    }
  }

  /**
   * Update a message
   */
  async updateMessage(options: {
    channel: string;
    ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<boolean> {
    const token = await this.getToken();
    try {
      const body: Record<string, unknown> = {
        channel: options.channel,
        ts: options.ts,
        text: options.text,
      };
      if (options.blocks) body.blocks = options.blocks;

      await slackFetch<SlackApiResponse>('/chat.update', {
        method: 'POST',
        token,
        body,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send an ephemeral message (only visible to a specific user)
   */
  async sendEphemeral(options: {
    channel: string;
    user: string;
    text: string;
    blocks?: unknown[];
  }): Promise<boolean> {
    const token = await this.getToken();
    try {
      const body: Record<string, unknown> = {
        channel: options.channel,
        user: options.user,
        text: options.text,
      };
      if (options.blocks) body.blocks = options.blocks;

      await slackFetch<SlackApiResponse>('/chat.postEphemeral', {
        method: 'POST',
        token,
        body,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(options: {
    channel: string;
    timestamp: string;
    reaction: string;
  }): Promise<boolean> {
    const token = await this.getToken();
    try {
      await slackFetch<SlackApiResponse>('/reactions.add', {
        method: 'POST',
        token,
        body: {
          channel: options.channel,
          timestamp: options.timestamp,
          name: options.reaction,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Open a modal view
   */
  async openModal(options: {
    triggerId: string;
    view: Record<string, unknown>;
  }): Promise<boolean> {
    const token = await this.getToken();
    try {
      await slackFetch<SlackApiResponse>('/views.open', {
        method: 'POST',
        token,
        body: {
          trigger_id: options.triggerId,
          view: options.view,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update a modal view
   */
  async updateModal(options: {
    viewId: string;
    view: Record<string, unknown>;
  }): Promise<boolean> {
    const token = await this.getToken();
    try {
      await slackFetch<SlackApiResponse>('/views.update', {
        method: 'POST',
        token,
        body: {
          view_id: options.viewId,
          view: options.view,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Respond to a slash command or interaction (with response_url)
   */
  async respondToUrl(responseUrl: string, options: {
    text: string;
    responseType?: 'in_channel' | 'ephemeral';
    blocks?: unknown[];
    replaceOriginal?: boolean;
    deleteOriginal?: boolean;
  }): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        text: options.text,
        response_type: options.responseType || 'ephemeral',
      };

      if (options.blocks) body.blocks = options.blocks;
      if (options.replaceOriginal !== undefined) body.replace_original = options.replaceOriginal;
      if (options.deleteOriginal !== undefined) body.delete_original = options.deleteOriginal;

      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return true;
    } catch (error) {
      console.error('[SlackService] Failed to respond to URL:', error);
      return false;
    }
  }

  /**
   * Get conversation history (recent messages)
   */
  async getConversationHistory(options: {
    channel: string;
    limit?: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
  }): Promise<{ messages: SlackMessage[]; hasMore?: boolean }> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      channel: options.channel,
      limit: String(options.limit || 50),
      inclusive: String(options.inclusive ?? true),
    });
    if (options.oldest) params.set('oldest', options.oldest);
    if (options.latest) params.set('latest', options.latest);

    try {
      const data = await slackFetch<any>(`/conversations.history?${params.toString()}`, { token });
      const messages = (data.messages || []).map((m: any) => ({
        ts: m.ts,
        threadTs: m.thread_ts,
        type: m.type,
        text: m.text || '',
        userId: m.user || m.bot_id || '',
        channelId: options.channel,
        reactions: m.reactions
          ? m.reactions.map((r: any) => ({
              name: r.name,
              count: r.count,
              users: r.users || [],
            }))
          : undefined,
      }));

      return { messages, hasMore: data.has_more };
    } catch {
      return { messages: [] };
    }
  }

  /**
   * Get thread replies
   */
  async getThreadReplies(options: {
    channel: string;
    threadTs: string;
    limit?: number;
  }): Promise<{ messages: SlackMessage[]; hasMore?: boolean }> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      channel: options.channel,
      ts: options.threadTs,
      limit: String(options.limit || 50),
    });

    try {
      const data = await slackFetch<any>(`/conversations.replies?${params.toString()}`, { token });
      const messages = (data.messages || []).map((m: any) => ({
        ts: m.ts,
        threadTs: m.thread_ts,
        type: m.type,
        text: m.text || '',
        userId: m.user || m.bot_id || '',
        channelId: options.channel,
      }));

      return { messages, hasMore: data.has_more };
    } catch {
      return { messages: [] };
    }
  }
}
