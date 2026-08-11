# v1.2.0 Backlog

Three items planned for v1.2.0. Status: **PLANNED** — none implemented yet.

This file is mirrored in both repos (`Focura-backend` / `Focura-client`).
Changelog entries live in each repo's `CHANGELOG.md` under `[Unreleased]`.

---

## 1. GA consent banner (frontend)

**Why:** Google Analytics loads unconditionally on every page
(`app/layout.tsx` → `components/Analytics/GoogleAnalytics.tsx`). The legal
pages describe analytics as opt-out; a real consent gate is the proper fix.

**Approach**
- New `components/Consent/ConsentBanner.tsx` (client component): fixed
  bottom banner shown once; Accept / Decline buttons; choice persisted in
  `localStorage` (e.g. `focura-consent: "accepted" | "declined"`); links to
  `/cookies`.
- `app/layout.tsx`: mount a small consent provider that renders the banner
  and passes `enabled={consent === "accepted"}` to `GoogleAnalytics`.
- `components/Analytics/GoogleAnalytics.tsx`: accept an `enabled` prop and
  render nothing (or only with Google's consent-mode command) until opted in.
- Strictly necessary + functional cookies stay always-on (no consent needed).
- Update `components/Cookies/CookiesContent.tsx`: "In-app consent toggles
  are planned" becomes real wording describing the banner.

**Acceptance criteria**
- First visit shows the banner; choice persists across reloads.
- GA scripts only load after Accept; Decline / no choice = no GA.
- `/cookies` page copy matches the new behaviour.
- Component tests for the banner and GA gating; existing cookies tests pass.

**Changelog entry (frontend)**
> Added a cookie-consent banner — Google Analytics now loads only after
> explicit opt-in.

---

## 2. SSE token hardening (backend + frontend)

**Why:** `GET /api/v1/notifications/stream?token=<15-minute access token>`
puts a full access token in URLs (proxy logs, browser history). The 30-second
single-use SSE token infrastructure already exists but is unused.

**Backend**
- `src/lib/auth/backendToken.ts`: `createSseToken()` exists (30s expiry,
  `type: "sse"`).
- `src/lib/auth/tokenRevocation.ts`: `storeSseToken()` / `consumeSseToken()`
  exist (Redis, 30s TTL, single-use).
- `src/routes/auth.routes.ts`: include `sseToken` in the `/exchange` and
  `/refresh` responses and store it via `storeSseToken`.
- `src/sockets/notification.stream.ts` (~line 254): verify the token with
  `verifyToken(token, "sse")`, then consume via `consumeSseToken`; reject
  invalid/expired/reused tokens. Stop accepting regular access tokens here.
- Update `AUTHENTICATION.md` and `FRONTEND_AUTH_GUIDE.md` SSE sections.
- Tests: exchange/refresh return a 30s sseToken; stream accepts it once;
  reuse is rejected; access tokens are rejected on the stream.

**Frontend**
- `lib/auth/authOptions.ts`: carry `sseToken` from the exchange/refresh
  responses into the session (`session.sseToken`).
- SSE connection (in `useNotifications` / the stream helper): use
  `session.sseToken` instead of the access token; reconnect when it rotates.

**Acceptance criteria**
- No URL on the site ever contains a 15-minute access token.
- A stream connection lives up to ~30s without a reconnect; the hook
  transparently reconnects with a fresh token.
- Replaying a used SSE token returns 401.

**Changelog entries**
> Backend: Hardened SSE authentication — notification streams now use a
> 30-second, single-use token instead of the access token, so tokens no
> longer appear in URLs or logs.
> Frontend: Notification streams now authenticate with a short-lived,
> single-use token.

---

## 3. Data export + account deletion (backend + frontend)

**Why:** the Privacy/Terms pages and help docs promise self-service export
and deletion, but the backend has neither. The legal pages currently say
"request via email"; self-service makes those promises real.

**Backend**
- Export: `POST /api/v1/user/export-data` (authenticated). Build a JSON
  bundle (profile, workspaces, projects, tasks, comments, focus sessions,
  time entries, recent notifications, activity) and email it to the user via
  the existing queue (new `data-export-email` type in
  `src/queue/queues/email.queue.ts` + `src/queue/workers/email.worker.ts`).
- Delete: `DELETE /api/v1/user/account` (authenticated) with guards:
  - Reject (409) if the user is the sole owner of a workspace that has other
    members — respond with the list so the UI can ask them to transfer
    ownership first (workspaces they solely own and are empty are deleted).
  - Revoke all sessions/tokens (existing Redis helpers), invalidate caches,
    enqueue the data purge, write an audit log entry.
- Wire in `src/routes/user.routes.ts` + `src/controllers/user.controller.ts`.
- Tests: unit + integration for export payload shape, deletion guards,
  token revocation on delete.

**Frontend**
- Settings → Account → Privacy: "Export my data" button calling the export
  endpoint with a status message (help docs already reference this path).
- Settings → Account → Danger Zone: "Delete account" confirmation flow that
  surfaces the ownership-transfer requirement when the API rejects.
- Update `components/Help/*` and `constants/guides.constants.ts` wording if
  needed.

**Acceptance criteria**
- Export generates and emails a complete JSON bundle within minutes.
- Account deletion revokes all sessions immediately and is blocked only for
  guarded workspaces with a clear reason.
- Audit log records both actions.

**Changelog entries**
> Backend: Added self-service data export (JSON bundle emailed on request)
> and account deletion with ownership-transfer guards.
> Frontend: Added Data Export and Account Deletion to Settings — matching
> the promises in the legal pages.
