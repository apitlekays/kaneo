# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kaneo is a self-hosted project management platform built with simplicity and performance as core principles. The codebase is organized as a **pnpm monorepo** with TurboRepo.

**Key Philosophy**: Features exist to solve real problems, not to impress. Avoid over-engineering - keep solutions simple and focused. Don't add features, refactoring, or improvements beyond what was asked.

## Development Commands

### Getting Started
```bash
# Install dependencies (uses pnpm)
pnpm install

# Start all development servers (API + web)
pnpm dev

# Lint and auto-fix code (Biome)
pnpm lint

# Build all packages
pnpm build
```

### API-Specific Commands
```bash
# Run API in development mode
pnpm --filter @kaneo/api dev

# Build API
pnpm --filter @kaneo/api build

# Generate database migrations (after schema changes)
pnpm --filter @kaneo/api db:generate

# Run database migrations (auto-runs on API startup)
pnpm --filter @kaneo/api db:migrate

# Open Drizzle Studio (database GUI)
pnpm --filter @kaneo/api db:studio

# Lint API code
pnpm --filter @kaneo/api lint
```

### Web-Specific Commands
```bash
# Run web app in development mode
pnpm --filter @kaneo/web dev

# Build web app for production
pnpm --filter @kaneo/web build

# Preview production build
pnpm --filter @kaneo/web preview

# Lint web code
pnpm --filter @kaneo/web lint
```

## Architecture Overview

### Monorepo Structure
```
kaneo/
├── apps/
│   ├── api/          # Backend API (Hono/Node.js/PostgreSQL)
│   ├── web/          # Frontend app (React/Vite/TanStack)
│   └── docs/         # Documentation site (Next.js)
├── packages/
│   ├── email/        # Email utilities
│   ├── libs/         # Shared libraries
│   └── typescript-config/  # TypeScript configurations
└── charts/           # Kubernetes Helm charts
```

### Technology Stack

**Backend (API)**
- Framework: Hono (lightweight web framework)
- Database: PostgreSQL with Drizzle ORM
- Authentication: Better Auth
- Validation: Valibot (Zod is also present, used by Better Auth and some schemas)
- API Documentation: OpenAPI (hono-openapi)
- IDs: CUID2 (via @paralleldrive/cuid2)

**Frontend (Web)**
- Framework: React 19+
- Routing: TanStack Router (file-based)
- Data Fetching: TanStack Query (React Query)
- Build Tool: Vite
- Styling: Tailwind CSS v4
- State Management: Zustand
- UI Components: Radix UI primitives

### Key Architectural Patterns

**Backend API Structure**
- Routes organized by feature in `apps/api/src/{feature}/`
- Controller pattern: business logic extracted to `{feature}/controllers/`
- All routes use OpenAPI decorators (`describeRoute`)
- All inputs validated with Valibot schemas
- Migrations auto-run on API startup

**Frontend Structure**
- File-based routing in `apps/web/src/routes/`
- Query hooks in `apps/web/src/hooks/queries/`
- Mutation hooks in `apps/web/src/hooks/mutations/`
- API fetchers in `apps/web/src/fetchers/{feature}/`
- Components in `apps/web/src/components/`

**Database Schema Conventions**
- All tables use CUID2 for primary keys (`createId()`)
- Every table has `createdAt` and `updatedAt` timestamps
- Foreign keys always specify cascade behavior (`onDelete`, `onUpdate`)
- Indexes on frequently queried columns (especially foreign keys)
- Schema defined in `apps/api/src/database/schema.ts`
- Relations defined in `apps/api/src/database/relations.ts`

**Authentication Flow**
- Better Auth handles authentication
- User context available in Hono via `c.get("userId")`, `c.get("user")`, `c.get("session")`
- API keys supported via Bearer token
- Frontend uses Better Auth client from `@/lib/auth-client`

**Event System**
- Events published for activity tracking
- Use `publishEvent()` from `apps/api/src/events/`
- Events tracked for features like status changes, assignments, etc.

## Code Style

### Formatting (Biome)
- **Indentation**: Spaces for JavaScript/TypeScript/TSX (tabs for other file types)
- **Quotes**: Double quotes
- **Semicolons**: Required
- **Ignored files**: CSS and `package.json` files are excluded from Biome linting/formatting
- Run `pnpm lint` to auto-fix

### TypeScript Conventions
- Prefer `type` over `interface` (only use interface when extending/merging)
- Prefer type inference when obvious
- File naming: PascalCase for components, kebab-case for utilities/hooks
- Hooks use `use` prefix: `use-task.ts`

### Import Organization
1. External packages
2. Internal packages (`@/` aliases)
3. Relative imports
Biome auto-organizes imports.

### Git Commits
Use Conventional Commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

Husky enforces commit message format via commitlint.

### Pre-commit Hooks
The pre-commit hook (`.husky/pre-commit`) runs two checks:
1. `biome ci .` — linting and formatting validation
2. `pnpm run build` — full monorepo build

Commits will be slow due to the build step. Ensure code compiles before committing.

## Environment Configuration

**Single `.env` file** in project root shared by all apps.

Required variables:
- `KANEO_CLIENT_URL` - Web app URL (e.g., http://localhost:5173)
- `KANEO_API_URL` - API URL (e.g., http://localhost:1337)
- `AUTH_SECRET` - JWT secret (min 32 chars)
- `DATABASE_URL` - PostgreSQL connection string
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

Optional:
- `CORS_ORIGINS` - Comma-separated allowed origins (empty = allow all in dev)
- `VITE_API_URL` - API URL for web dev (defaults to http://localhost:1337)
- `REDIS_URL` - Redis connection string for multi-instance WebSocket broadcasts via Pub/Sub (omit for single-instance in-memory mode)
- SSO providers (GitHub, Google, Discord, Custom OAuth/OIDC)
- SMTP configuration

See `ENVIRONMENT_SETUP.md` for detailed configuration and troubleshooting.

## Development Workflow

### When Making Changes

1. **Read before modifying**: Never propose changes to code you haven't read
2. **Use existing patterns**: Follow the established controller/fetcher/hook patterns
3. **Avoid over-engineering**: Don't add features beyond what's requested
4. **Type safety**: Let TypeScript guide you - all APIs are fully typed
5. **Validate inputs**: Always use Valibot schemas for API inputs
6. **Error handling**: Backend uses HTTPException, frontend uses toast notifications

### Database Changes

1. Modify schema in `apps/api/src/database/schema.ts`
2. Generate migration: `pnpm --filter @kaneo/api db:generate`
3. Migration auto-runs on next API startup
4. Always use CUID2 for IDs, include timestamps, specify cascade behavior

### Adding API Endpoints

1. Create controller in `apps/api/src/{feature}/controllers/`
2. Add route in `apps/api/src/{feature}/index.ts`
3. Use `describeRoute` for OpenAPI docs
4. Use `validator` with Valibot schema
5. Keep route handler thin - business logic in controller

### Adding Frontend Features

1. Create fetcher in `apps/web/src/fetchers/{feature}/`
2. Create query/mutation hook in `apps/web/src/hooks/`
3. Use TanStack Query for caching
4. Handle loading/error states properly
5. Use toast notifications (sonner) for user feedback

## Three kinds of "minutes" — do not conflate them

This codebase has three unrelated features that all get called "minutes" in
conversation. They share nothing but the word. Before writing or reviewing
anything that mentions minutes, work out which one is meant.

| End-user name | Code / tables | Scope | Where |
|---|---|---|---|
| **Meeting Minutes** | `meeting_minute*` | Organisation-level meetings — AGM, quarterly committee, EGM | General Management → Minutes Manager |
| **Project Minutes** | `task_mom` (MoM) | One meeting attached to a single task, inside one project | Project → Minutes |
| **Letter Minutes** | `letter_minute`, `letter_minute_update` | Annotations and delegated actions on one piece of correspondence | Correspondence → letter detail |

Rules:

- **Never rename the existing two.** `task_mom` and `letter_minute` are
  live, migrated and deployed; the cost of renaming exceeds the confusion it
  would save.
- **New organisation-level tables take the `meeting_` prefix**, never a bare
  `minute_`, so a grep for a table name can never return two modules.
- The three are **separate domains with separate storage**. They deliberately
  converge only on the shared central surfaces: notifications, the alert
  bell, and the pending-decision dialog, so a user sees one unified Home
  regardless of which module generated the work.
- In UI copy, always use the full two-word name — "Meeting Minutes", not
  "Minutes" — anywhere the three could be confused.

### Meeting Minutes refinements — the build order (decided 2026-08-27)

Six refinements to the organisation-level Meeting Minutes module were split
into **four specs, built in this order**. The order is not arbitrary and
should not be reshuffled for convenience:

| # | Spec | Covers | Why here |
|---|---|---|---|
| **A** | `2026-08-27-meetings-library-design.md` | document cards, lazy loading, omni search | no new infrastructure; ships visible value first |
| **B** | `2026-08-27-minute-item-bulk-import-design.md` | CSV import, `/`-marked rows become Actions | introduces `numbering`, which **C depends on** |
| **C** | `2026-08-27-action-follow-through-design.md` | action reply threads, Configure → memorandum email | self-contained once `numbering` exists |
| **D** | `2026-08-27-archival-documents-search-design.md` | PDF archive, OCR, full-text search | heaviest infrastructure and highest risk — last, so it blocks nothing |

The two hard dependencies: **B before C** (`numbering` is rendered in the
memorandum's subject line and table), and **A before D** (D extends A's
single `q` search parameter rather than adding a second search box).

Requirements, both rounds of answers, and the rationale for the split live
in `docs/superpowers/specs/2026-08-27-minutes-manager-refinements-REQUIREMENTS.md`
— read it before designing or implementing any of the four.

## Important Notes

- **Package Manager**: This project uses **pnpm** (pinned to `10.32.1` via `packageManager` field), not npm or yarn. Requires Node `>=18`
- **Migrations**: Auto-run on API startup, stored in `apps/api/drizzle/`
- **Development Ports**: API runs on 1337, web runs on 5173
- **Hot Reload**: Both API and web have watch mode via `pnpm dev`
- **CORS**: Configured in API index.ts, controlled by `CORS_ORIGINS` env var
- **Testing**: Run `pnpm test` at the repo root (Turbo runs `test` in packages that define it: API unit tests, web unit/component tests, shared packages). API integration tests: `pnpm test:integration` (requires PostgreSQL; env is set in `tests/api-integration/setup.ts`; CI uses `.github/workflows/ci.yml`). **If you override `DATABASE_URL` — e.g. to run against your own container on a non-default port — do NOT use the root command.** `turbo.json`'s `test:integration` task declares no `env`/`passThroughEnv`, so turbo silently drops the override and the suite falls back to port 5432, failing with a confusing `ECONNREFUSED 127.0.0.1:5432` on most tests. Bypass turbo instead: `DATABASE_URL=… pnpm --filter @kaneo/api test:integration`. Verified empirically 2026-08-24 (root: 152/155 fail; filtered: 155/155 pass). Vitest configs: `apps/api/vitest.config.ts` (unit), `apps/api/vitest.integration.config.ts` (integration), `apps/web/vitest.config.ts` (web). Integration tests live under `tests/api-integration/`; API unit tests under `tests/api/`.
- **Typecheck**: `pnpm typecheck` (`turbo typecheck`) runs in CI (`ci.yml`, its own job) and `tsc --noEmit` per package — currently `@kaneo/api` and `@kaneo/web`; packages whose `build` script is already `tsc` (email, mcp, permissions) are redundant to typecheck separately and don't get their own script. The turbo task **must** declare `dependsOn: ["^build"]`: `apps/web` (and `apps/api`) typecheck against the *built* `dist/*.d.ts` of `@kaneo/permissions`/`@kaneo/email`, not their source, so a stale or missing `dist` produces confusing, unrelated-looking errors rather than a clean pass/fail — this bit stage 2b of the effort that added this gate. `@kaneo/libs` is deliberately not wired in: it has no build step and its one consumer (`apps/web`) already typechecks it in context; a standalone `tsc --noEmit` on its own tsconfig surfaces 6 phantom errors in `apps/api/src/redis/*` and `ws/redis-broadcast-adapter.ts` caused by @types/node version skew across workspaces (not real bugs — those files pass clean under every tsconfig that actually ships them).
- **Web component tests**: `apps/web/vitest.config.ts` deliberately does NOT set `globals: true`, so Testing Library cannot auto-unmount. `apps/web/src/test/setup.ts` registers `afterEach(cleanup)` for every file — do not remove it, and no test file needs its own (several still have one; it is harmless but redundant). `apps/web/src/test/cleanup.test.tsx` guards this: drop the registration and its second case fails with "found multiple elements".
- **Asserting a disabled Base UI control**: `Checkbox` renders `<span role="checkbox">`, not a native input, so jest-dom's `toBeDisabled()` **fails** against it even when it is genuinely disabled — a confusing false negative, not a silent pass. Assert `toHaveAttribute("aria-disabled", "true")` instead. Native `<button>` targets are unaffected; `toBeDisabled()` is correct there.
- **Security**: Never commit secrets, always validate inputs, sanitize outputs

## Pushing and Deploying

Established by inspecting the repo, its Actions history and the account's
hosting on 2026-08-21. Read this before asking how to ship anything.

### The repository

`origin` is <https://github.com/apitlekays/kaneo> — a **public fork** of
`usekaneo/kaneo`. Pushing publishes the code publicly; there is no private
remote. There is no `upstream` remote configured locally.

### How work lands

Commits go **directly to `main`**. Every run in Actions history is a `push`
on `main` — this repo does not use a PR flow, and `auto-merge.yml` /
`auto-assign.yml` are inherited from upstream and unused here. Branch for a
feature if it helps, but merge it locally (`--no-ff`) and push `main`.

`git push origin main` is the whole deploy-adjacent step that actually
exists today. It triggers `ci.yml` (lint + typecheck + unit + integration
against a service Postgres). `deploy-site.yml` only fires when
`apps/site/**`, `packages/**` or the lockfile change, and publishes the
docs site to GitHub Pages — it is not the app.

### Commit hooks

The pre-commit hook runs `biome ci .` **and a full monorepo build**, so
commits are slow. `--no-verify` is normal for incremental work, but then
**`biome ci .` must be run manually before pushing** — CI's lint job runs it
over all files and fails the run otherwise. Note `biome ci .` over the whole
repo catches things `biome check <files>` on a subset does not.

Generated drizzle snapshots under `apps/api/drizzle/meta/` are excluded from
Biome in `biome.json`. They are machine-generated and must never be
hand-edited, so linting them only ever produced failures.

### Releases and images — manual, and unused in this fork

CI's `docker-build` job already builds `Dockerfile.kaneo` on every push as a
smoke test, with `push: false` — so a green CI proves the image builds; it
just does not publish it.

`docker.yml` (build + publish to GHCR) and `release.yml` (cut a GitHub
release) are **`workflow_dispatch` only** — they never run automatically.
Neither has been dispatched in this fork: `gh release list` is empty, and
the `v2.x` tags are inherited from upstream. Trigger with
`gh workflow run docker.yml -f version=X.Y.Z -f latest=true`.

### The deployment target: MAPIMCore

**When the user says "deploy", this is what they mean.** The production
instance of this fork is <https://core.mapim.dev>, branded **MAPIMCore**.

| | |
|---|---|
| Host | Hostinger VPS id **1137184**, hostname `core.mapim.dev` |
| IP | `72.61.120.91` (IPv6 `2a02:4780:5e:4f1f::1`); PTR stays `srv1137184.hstgr.cloud` |
| Spec | KVM 2 — 2 vCPU, 7.8 GB RAM, 96 GB disk (~9% used), Ubuntu 24.04 LTS |
| Created | 2025-11-18, datacenter 21 |

The other two VPSs on the account are unrelated: `srv1651323` runs
openclaw + traefik, and `hackedu.tech` runs the hackedu Astro app.

**Hostinger's Docker Manager API cannot introspect this VPS** — its OS
template is plain Ubuntu 24.04 rather than the Docker+Traefik template, so
`VPS_getProjectListV1` returns `[VPS:2044] ... does not support Docker
Manager`. That is an API limitation, **not** evidence that nothing runs
there. Use SSH.

**Renaming the VPS reboots it.** Both `VPS_setHostnameV1` calls made on
2026-08-24 rebooted the box and took the site down for a few minutes until
the containers came back. The API does not warn about this. Hostnames must
also be a lowercase FQDN — `MAPIMCore` and `mapimcore` were both rejected
with `[VPS:2004] The hostname format is invalid`.

### Access

```bash
ssh -i ~/.ssh/hostinger_vps1_ed25519 root@72.61.120.91
```

`hostinger_vps1_ed25519.pub` carries the comment `claude-vps1-20260624`. The
other keys in `~/.ssh` are for unrelated hosts — `hackedu_deploy_*` belongs
to `hackedu.tech`.

### Versioning — bump on every deploy

**Every deploy bumps the version in the root `package.json`. No deploy ships
an unchanged version number.** That number is what appears bottom-left in the
UI, so it is how anyone tells which build is live without SSH access.

**Claude proposes the level and says why; the user confirms.** Do not bump
silently, and do not ask an open "what version?" — recommend one, give the
one-line reason, and let the user override.

Choosing the level. This is a self-hosted product, not a library, so read
semver in terms of *who has to do something*:

| Level | When | Examples |
|---|---|---|
| **patch** | Nothing changes for users or operators | bug fix, copy, styling, refactor, perf, dependency bump |
| **minor** | New capability, existing workflows untouched | a new surface or route, additive tables/columns, a new panel |
| **major** | Someone must change what they do | an operator step (manual migration, new env var, config change), a destructive or non-additive migration, a removed feature, or a workflow change users must be warned about |

The tie-breaker is the major/minor line, so record where it was drawn:
**2.8.0** shipped interactive minutes, minute-action acceptance and task
assignment acceptance as a **minor** — migrations were additive and no
operator action was needed — even though assigning a task stopped granting
it, which changed daily behaviour for every user. If "users must be retold
how the app works" counts as breaking for you, that release was a 3.0.0.
Say so and the line moves.

Mechanics: edit the root `package.json`, commit as
`chore: bump version to X.Y.Z`, **push**, then deploy — `kaneo-deploy` builds
`origin/main`, so an unpushed bump ships the old number.

`CHANGELOG.md` is **upstream's**, generated by their release automation and
last touched at 2.7.7 (2026-05-29). Fork versions never appear in it, and the
UI's version link points at upstream's changelog — so a bump here produces no
release notes anywhere. Worth fixing if release notes ever matter.

### How to deploy — one command

```bash
ssh -i ~/.ssh/hostinger_vps1_ed25519 root@72.61.120.91 'kaneo-deploy <tag>'
```

`/usr/local/bin/kaneo-deploy` does everything, so never hand-roll the steps:
(1) hard-resets `/opt/build/kaneo` to `origin/main`, (2) builds `kaneo:<tag>`
from `Dockerfile.kaneo`, (3) backs up the compose file to
`docker-compose.yml.bak.<timestamp>` and repoints the `kaneo` service image,
(4) `docker compose up -d kaneo` and blocks until healthy — up to 180s,
printing logs and the rollback command if not — then (5) runs `kaneo-prune`.

**It deploys `origin/main`, not your working copy — push first**, or you
will ship the previous commit and think you shipped yours.

**Tag the image `v<version>`**, matching the bump you just made, so the image
tag, the number in the UI and the commit all agree — e.g. `kaneo-deploy
v2.8.0`. Allowed chars `A-Za-z0-9._-`. Tags before 2.8.0 were feature names
(`central-alerts`, `pending-decision`, `register-fields`, `letter-linking`,
`project-visibility`, `assignment-acceptance`); that was the old convention
and reading the running tag no longer told you which build was live.

**The tag does not set the displayed version.** The `v2.x.y` shown bottom
left comes from the **root** `package.json` `version`, injected by
`apps/web/vite.config.ts` as `__APP_VERSION__` and rendered by
`components/version-display.tsx`. `apps/web/package.json` is `0.0.0` and is
not the source. Tagging an image `v2.8.0` without bumping root
`package.json` ships the old number — that is exactly what happened on the
`assignment-acceptance` deploy.

**Rollback** — the previous compose backup:

```bash
cp -a /opt/stacks/kaneo/docker-compose.yml.bak.<timestamp> \
      /opt/stacks/kaneo/docker-compose.yml
cd /opt/stacks/kaneo && docker compose up -d kaneo
```

Migrations run on API startup, so a deploy applies pending drizzle
migrations to production data. Rolling the *image* back does **not** roll
migrations back — safe only because migrations here are additive (new
tables, new nullable/defaulted columns), which older images ignore. A
destructive migration would break that assumption.

Verify a deploy from outside: `/api/health` returns 200, `/api/me` returns
401, and the `assets/index-*.js` hash in the served HTML changes.

### What runs on the box

Docker 29.6.0 / Compose 5.1.4. Three stacks under `/opt/stacks/`, also
manageable through Portainer. Nothing is installed as a systemd service.

- **`kaneo`** (`/opt/stacks/kaneo/docker-compose.yml`)
  - `kaneo` — image `kaneo:<tag>`, **built locally, never pulled**. Listens
    on 5173 internally, publishes no host port, joins `proxy_default`.
    Healthcheck hits `/api/health`.
  - `kaneo-postgres` — `postgres:16-alpine`, volume `kaneo_postgres_data`,
    database and user both `kaneo` (~14 MB as of 2026-08-24).
- **`minio`** (`/opt/stacks/minio/`) — `minio/minio:latest`, volume
  `minio_minio_data`, CORS pinned to `https://core.mapim.dev`. Backs letter
  attachments.
- **`proxy`** (`/opt/stacks/proxy/`) — `nginx-proxy-manager` (the openresty
  in response headers; owns 80/443/81 and the Let's Encrypt certs in
  `proxy_npm_letsencrypt`), `portainer` (8000/9443), and `landing`
  (nginx:alpine serving `/opt/landing`).

Config lives in `/opt/stacks/kaneo/.env` (root-only, `.bak.*` copies
alongside). Keys: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`AUTH_SECRET`, `KANEO_CLIENT_URL`, `SMTP_*`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_PICKER_API_KEY`. Never print values.

**Do not** run the repo's `compose.yml` against this box: it pulls
`ghcr.io/usekaneo/kaneo:latest`, which is **upstream's** image and does not
contain this fork's code.

### Firewall, backups, housekeeping

`ufw` is **inactive**; filtering is done by the Hostinger firewall group
`317107` (`vps1-portainer-npm`): 22/80/443 open to any, and 81/8000/9443
(NPM admin and Portainer) restricted to `219.92.41.147`. The API reports
`is_synced: false`, but the rules **are** enforced — verified 2026-08-24 by
probing from an unlisted IP, where 81/8000/9443 are filtered. Do not "fix"
that flag on the strength of the API alone.

Hostinger backups are weekly, two retained, ~1800s restore time. Snapshots
therefore lag; do not treat them as a pre-deploy safety net.

Cron: `kaneo-prune` daily at 04:15 (`KANEO_RETAIN=5` — keeps the 5 newest
`kaneo:*` tags plus the running one, and trims compose backups to 5), and
`docker builder prune -f` Saturdays at 05:04. Log at
`/var/log/kaneo-prune.log`.


## Common Patterns

### Backend Route Example
```typescript
// apps/api/src/{feature}/index.ts
import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import getItem from "./controllers/get-item";

const feature = new Hono<{ Variables: { userId: string } }>()
  .get("/:id",
    describeRoute({
      operationId: "getItem",
      tags: ["Feature"],
      description: "Get item by ID"
    }),
    validator("param", v.object({ id: v.string() })),
    async (c) => {
      const { id } = c.req.valid("param");
      const item = await getItem(id);
      return c.json(item);
    }
  );
```

### Frontend Query Hook Example
```typescript
// apps/web/src/hooks/queries/{feature}/use-item.ts
import { useQuery } from "@tanstack/react-query";
import { getItem } from "@/fetchers/{feature}/get-item";

export function useItem(itemId: string) {
  return useQuery({
    queryKey: ["item", itemId],
    queryFn: () => getItem(itemId),
  });
}
```

### Database Schema Example
```typescript
// apps/api/src/database/schema.ts
export const exampleTable = pgTable("example", {
  id: text("id").$defaultFn(() => createId()).primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("example_projectId_idx").on(table.projectId),
]);
```
