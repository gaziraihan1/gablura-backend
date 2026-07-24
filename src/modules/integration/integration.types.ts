// ─── Integration Provider Types ────────────────────────────────────────────────

export type IntegrationProvider = 'github' | 'slack' | 'google-calendar' | 'trello';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

export interface OAuthState {
  provider: IntegrationProvider;
  userId?: string;
  workspaceId?: string;
  csrfToken: string;
}

// ─── Integration Config Types ─────────────────────────────────────────────────

export interface IntegrationConfig {
  workspaceId?: string;
  syncDirection?: 'one-way' | 'two-way';
  autoSync?: boolean;
  syncInterval?: number; // seconds
  notifications?: boolean;
  notificationChannel?: string; // Slack channel
  notifyMembers?: boolean;
  allowedMembers?: string[]; // User IDs (empty = all)
  selectedChannels?: string[];
  selectedRepos?: string[];
  projectMapping?: Record<string, string>;
}

export interface SyncStatus {
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed' | 'pending';
  syncCount?: number;
  error?: string;
}

// ─── API Request/Response Types ───────────────────────────────────────────────

export interface CreateIntegrationInput {
  provider: IntegrationProvider;
  workspaceId?: string;
}

export interface UpdateIntegrationConfigInput {
  config: IntegrationConfig;
}

export interface OAuthCallbackInput {
  code: string;
  state: string;
  provider: IntegrationProvider;
  redirectUri: string;
}

export interface IntegrationResponse {
  id: string;
  name: string;
  provider: IntegrationProvider;
  active: boolean;
  connectedAt: Date;
  config?: IntegrationConfig;
  syncStatus?: SyncStatus;
  webhookUrl?: string;
  connectedBy?: {
    id: string;
    name: string | null;
    email: string;
  };
}

// ─── Provider-Specific Types ──────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  body?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isChannel: boolean;
  isGroup: boolean;
  isIM: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}
