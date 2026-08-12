# Changelog

All notable changes to the Focura backend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v1.2.0
- Added self-service data export — a JSON bundle of your data is generated and emailed on request
- Added self-service account deletion with ownership-transfer guards
- Hardened SSE authentication — notification streams now use a 30-second, single-use token instead of the 15-minute access token
- Added `GET /api/v1/notifications/sse-token` so each stream connection mints a fresh single-use token; the stream now sends data-carrying heartbeats so idle connections stay alive
- Notification coverage: meeting reminders (24h/1h/15m before start), creator + assignee notification on task completion, assignee-added notifications on re-assignment, parent-task notifications for new subtasks, workspace-membership validation for meeting attendees, and due-date reminders for creator-only tasks

## [1.1.0] - 2026-08-11

First tagged release.

### Added
- AI Assistant powered by Google Gemini — task autocomplete, goal breakdown, comment assist, daily planning, meeting summaries, weekly insights, with per-plan quotas and usage tracking
- Enterprise plan with admin-overridable per-workspace AI allowances (daily calls, monthly tokens, max output tokens)
- Admin dashboard workspace AI-limit overrides, audit-logged to the activity feed, with email + in-app owner notifications
- Project templates: community ratings, featured status, moderation workflow, and template-driven automation rules
- Task recurrence, milestones/sprints, GitHub entity linking, Slack notifications
- Integrations: GitHub, Slack, Google Calendar, Trello (OAuth, sync, webhooks); API-key management
- Two-factor authentication (TOTP)
- BullMQ queue architecture for email, notifications, analytics, calendar, and automation workloads

### Changed
- Workspace ownership transfer; project sections; wellness/energy tracking
- Expanded Paddle webhook event coverage

### Security
- Session lifecycle hardening: device/IP binding, hijack detection, max-sessions eviction, inactivity + absolute timeouts, distributed refresh locking, token replay detection
- Header-based CSRF with Redis-backed tokens; tiered rate limiting; security headers
- Argon2id password hashing; AES-256-GCM encryption for integration tokens
- Sentry error tracking (authorization headers stripped before upload)

[Unreleased]: https://github.com/gaziraihan1/focura-backend/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/gaziraihan1/focura-backend/releases/tag/v1.1.0
