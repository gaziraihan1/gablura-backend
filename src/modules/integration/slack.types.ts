// ─── Slack Provider Types ─────────────────────────────────────────────────────

export interface SlackUser {
  id: string;
  teamId?: string;
  name?: string;
  realName?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isChannel: boolean;
  isGroup: boolean;
  isIM: boolean;
  isMember?: boolean;
  topic?: string;
  purpose?: string;
  memberCount?: number;
}

export interface SlackMessage {
  ts: string;
  threadTs?: string;
  type: string;
  text: string;
  userId: string;
  userDisplayName?: string;
  channelId: string;
  channelName?: string;
  permalink?: string;
  attachments?: SlackAttachment[];
  blocks?: unknown[];
  reactions?: SlackReaction[];
}

export interface SlackAttachment {
  id?: number;
  title?: string;
  text?: string;
  fallback?: string;
  color?: string;
  imageUrl?: string;
  thumbUrl?: string;
  footer?: string;
  ts?: number;
}

export interface SlackReaction {
  name: string;
  count: number;
  users: string[];
}

export interface SlackBlock {
  type: string;
  blockId?: string;
  [key: string]: unknown;
}

export interface SlackView {
  id: string;
  type: string;
  title: { type: string; text: string };
  blocks: SlackBlock[];
  state?: {
    values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>;
  };
  privateMetadata?: string;
  callbackId?: string;
}

// ─── Webhook Event Types ──────────────────────────────────────────────────────

export interface SlackEventPayload {
  token: string;
  teamId: string;
  apiAppId: string;
  event: SlackEvent;
  type: 'event_callback' | 'url_verification';
  eventId: string;
  eventTime: number;
  challenge?: string;
  authedUsers?: string[];
  authedTeams?: string[];
}

export interface SlackEvent {
  type: string;
  eventTs?: string;
  ts?: string;
  user?: string;
  channel?: string;
  channelType?: string;
  text?: string;
  subtype?: string;
  threadTs?: string;
  reactions?: SlackReaction[];
  item?: {
    type: string;
    channel: string;
    ts: string;
  };
  reaction?: string;
}

export interface SlackSlashCommand {
  token: string;
  teamId: string;
  teamDomain: string;
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
  command: string;
  text: string;
  apiAppId: string;
  responseUrl: string;
  triggerId: string;
}

export interface SlackInteractionPayload {
  type: 'block_actions' | 'view_submission' | 'view_closed' | 'message_action' | 'shortcut';
  team: { id: string; domain: string };
  user: { id: string; name: string; teamId?: string };
  channel?: { id: string; name: string };
  message?: {
    ts: string;
    text?: string;
    blocks?: SlackBlock[];
    channel?: string;
  };
  view?: SlackView;
  actions?: Array<{
    actionId: string;
    blockId: string;
    text?: { type: string; text: string };
    value?: string;
    type: string;
    actionTs?: string;
    selectedOption?: { value: string };
  }>;
  responseUrl?: string;
  triggerId?: string;
  messageTs?: string;
  callbackId?: string;
  privateMetadata?: string;
}

// ─── API Request/Response Types ──────────────────────────────────────────────

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface SlackConversationsListResponse extends SlackApiResponse {
  channels: SlackChannel[];
  response_metadata?: { next_cursor?: string };
}

export interface SlackUsersListResponse extends SlackApiResponse {
  members: SlackUser[];
  response_metadata?: { next_cursor?: string };
}

export interface SlackPostMessageResponse extends SlackApiResponse {
  channel: string;
  ts: string;
  message?: SlackMessage;
}

export interface SlackOpenViewResponse extends SlackApiResponse {
  view?: SlackView;
}

// ─── Task Linking Types ──────────────────────────────────────────────────────

export interface SlackTaskLink {
  taskId: string;
  channelId: string;
  messageTs: string;
  threadTs?: string;
  linkedAt: string;
  linkedByUserId: string;
}

export interface SlackTaskCreateInput {
  title: string;
  description?: string;
  channelId: string;
  messageTs: string;
  threadTs?: string;
  workspaceId: string;
  createdById: string;
  slackUserId: string;
  slackUserDisplayName?: string;
}

export interface SlackTaskUpdateInput {
  taskId: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  channelId?: string;
  threadTs?: string;
}
