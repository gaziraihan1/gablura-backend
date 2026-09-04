# Releasing Gablura Backend

How to cut a release. The frontend repo (`Gablura-client`) uses the same steps —
**keep both repos on the same version**.

## Versioning

- SemVer: `MAJOR.MINOR.PATCH`
  - `MAJOR` — breaking API / schema changes
  - `MINOR` — new features (backward compatible) — most of our releases
  - `PATCH` — bug fixes only
- **Keep the version identical across both repos.** The product ships as one;
  divergent versions make deploys and rollbacks confusing.
- Pre-releases before a final tag: `v1.1.0-beta.1`, `v1.1.0-rc.1` (as GitHub
  pre-releases).
- Tag history: backend's first tag is `v1.1.0`. Frontend has `v1.0.0-beta`,
  `v1.0.0-stable`, `v1.1.0`.

## Tag format

- Annotated tags only: `v1.1.0` (never lightweight tags).
- Tag the `chore(release)` commit created by `npm version` — never tag an
  arbitrary commit.

## Release steps

```bash
# 0. Pre-flight
git checkout main && git pull
git status                    # must be clean

# 1. Local sanity checks (CI runs the full suite on push)
npm run lint
npm run test:unit

# 2. Bump + tag (creates a commit AND an annotated tag)
npm version 1.1.0 -m "chore(release): backend v1.1.0"

# 3. Verify
git tag -l                    # v1.1.0 present
git cat-file -t v1.1.0        # prints "tag" (annotated)

# 4. Ship — Railway auto-deploys main and runs `prisma migrate deploy`
git push origin main --tags

# 5. GitHub Release — title `v1.1.0`, notes from:
git log --oneline --no-merges <previous-tag>..HEAD
```

## Deployment & rollback

- Railway auto-deploys on push to `main`; the start command is
  `npm run deploy` = `build && prisma migrate deploy && start`.
- After deploy, verify: `curl <host>/health`, then a login → API round trip.
- Rollback: Railway → redeploy the previous successful deployment.
