# Changelog

All notable changes to the Focura client are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added a cookie-consent banner — Google Analytics now loads only after explicit opt-in
- Added Data Export and Account Deletion to Settings — matching the promises in the legal pages

### Planned for v1.2.0
- Notification streams now authenticate with a short-lived, single-use token minted per connection (`/api/v1/notifications/sse-token`), carried through the session via exchange/refresh; idle streams stay alive with data-carrying heartbeats

## [1.1.0] - 2026-08-11

### Added
- AI Assistant UI with quota and usage display (Enterprise plan + admin AI limit overrides)
- Enterprise plan selector and admin workspace updates
- Task recurrence; calendar, timeline, and kanban views; sprint/milestone/saved-view filters; project sections; focus-management features
- Community template ratings and tier-gated template catalog
- Workspace integrations: GitHub linking, Slack, Google Calendar, Trello (with disconnect confirmation)
- SSE notification system with per-project preferences; global search; offline support (service worker + IndexedDB) with mutation syncing
- Wellness & capacity tracking, burnout dashboard, analytics with date-range filters and CSV export
- Two-factor authentication UI

### Changed
- Framer Motion standardization across the app; dynamic Open Graph images; redesigned landing/settings pages; accessibility and keyboard navigation improvements
- Privacy, Cookie, and Terms pages rewritten to match the product (real cookie list, correct providers, honest consent wording)

### Fixed
- Dashboard, task-filtering, and error-handling fixes across the app (167 commits since v1.0.0-stable)

### Security
- Proactive token refresh with request queuing; hardened authentication error handling

[Unreleased]: https://github.com/gaziraihan1/focura-client/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/gaziraihan1/focura-client/compare/v1.0.0-stable...v1.1.0
