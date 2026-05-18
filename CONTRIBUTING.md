# Contributing to posgoose

Thanks for your interest. posgoose is a solo-maintained project — issues and focused PRs are welcome.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Running Tests](#running-tests)
- [Running Benchmarks](#running-benchmarks)
- [Code Guidelines](#code-guidelines)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Releasing a New Version](#releasing-a-new-version)

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 20 LTS |
| npm | 10+ |
| Docker | 24+ (for test and benchmark databases) |

---

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-org/posgoose.git
cd posgoose

# 2. Install dependencies
npm install

# 3. Start the test database
docker run -d \
  --name posgoose-test-db \
  -e POSTGRES_USER=posgoose \
  -e POSTGRES_PASSWORD=posgoose \
  -e POSTGRES_DB=posgoose_test \
  -p 5433:5432 \
  --health-cmd "pg_isready -U posgoose" \
  --health-interval 5s \
  postgres:18-alpine

# Wait until healthy
docker inspect --format='{{.State.Health.Status}}' posgoose-test-db
# → "healthy"
```

---

## Running Tests

The test suite requires a live PostgreSQL instance. With the container from the setup above already running:

```bash
npm test
```

The default connection string is `postgresql://posgoose:posgoose@localhost:5433/posgoose_test`. Override it with `TEST_DATABASE_URL` if your setup differs:

```bash
TEST_DATABASE_URL=postgresql://user:pass@host:port/db npm test
```

---

## Running Benchmarks

The benchmark folder contains a separate Docker Compose setup that runs both PostgreSQL and MongoDB under equal resource constraints. See [`benchmark/`](./benchmark) for full details.

```bash
# Start benchmark containers (2 CPU / 512 MB each)
cd benchmark
docker compose up -d

# Install benchmark dependencies (requires posgoose dist — build first)
npm run build   # from repo root
npm install     # from benchmark/

# Seed + run all benchmarks
npm run bench
```

---

## Code Guidelines

- **TypeScript strict mode** — no `any`, no `@ts-ignore` without a comment explaining why
- **No unused exports** — keep the public API surface small
- **No new dependencies without discussion** — open an issue first
- **Field names are interpolated into SQL** — always call `validateFieldName()` on any user-supplied identifier before embedding it in a query string
- **Parameterized values only** — all user-supplied values must go through `$n` placeholders, never string-concatenated into SQL

Run the type-checker before committing:

```bash
npm run lint    # tsc --noEmit
```

---

## Submitting a Pull Request

1. **Open an issue first** for anything non-trivial so we can agree on the approach before you invest time coding
2. Fork the repo and create a branch from `main`
3. Make your changes, add or update tests to cover them
4. Ensure `npm run lint` and `npm test` both pass
5. Submit the PR — describe *why* the change is needed, not just what it does

PRs that add features without tests, break existing tests, or introduce new dependencies without prior discussion will not be merged.

---

## Releasing a New Version

Releases are fully automated — the CI pipeline publishes to npm and creates a GitHub release whenever it detects that the version in `package.json` has changed and is not yet on npm.

**To cut a release:**

```bash
# On your local main branch, up to date with origin

# Patch release  (0.1.0 → 0.1.1)  — bug fixes
npm version patch

# Minor release  (0.1.0 → 0.2.0)  — new backward-compatible features
npm version minor

# Major release  (0.1.0 → 1.0.0)  — breaking changes
npm version major

# Push the commit (npm version creates one automatically)
git push origin main
```

`npm version` bumps `package.json`, commits the change, and creates a local git tag. Pushing the commit to `main` triggers the CI pipeline which:

1. Runs the full build + test suite
2. Detects the version bump
3. Pushes the git tag to GitHub
4. Creates a GitHub release with auto-generated notes
5. Publishes the new version to npm

> **Note:** Do not push the local tag created by `npm version`. The CI creates and pushes the tag itself to keep everything in sync. If you accidentally push the tag, delete it from GitHub before the pipeline runs (`git push origin :refs/tags/v<version>`).

### Version policy

| Change type | Version bump |
|---|---|
| Bug fix, internal refactor | `patch` |
| New feature, new operator support | `minor` |
| Breaking API change, schema incompatibility | `major` |
