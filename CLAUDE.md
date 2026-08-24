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

## Important Notes

- **Package Manager**: This project uses **pnpm** (pinned to `10.32.1` via `packageManager` field), not npm or yarn. Requires Node `>=18`
- **Migrations**: Auto-run on API startup, stored in `apps/api/drizzle/`
- **Development Ports**: API runs on 1337, web runs on 5173
- **Hot Reload**: Both API and web have watch mode via `pnpm dev`
- **CORS**: Configured in API index.ts, controlled by `CORS_ORIGINS` env var
- **Testing**: Run `pnpm test` at the repo root (Turbo runs `test` in packages that define it: API unit tests, web unit/component tests, shared packages). API integration tests: `pnpm test:integration` (requires PostgreSQL; env is set in `tests/api-integration/setup.ts`; CI uses `.github/workflows/ci.yml`). Vitest configs: `apps/api/vitest.config.ts` (unit), `apps/api/vitest.integration.config.ts` (integration), `apps/web/vitest.config.ts` (web). Integration tests live under `tests/api-integration/`; API unit tests under `tests/api/`.
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
instance of this fork is:

| | |
|---|---|
| URL | <https://core.mapim.dev> (branded **MAPIMCore**) |
| Host | Hostinger VPS id **1137184**, hostname `mapimcore.mapim.dev` |
| IP | `72.61.120.91` (PTR remains `srv1137184.hstgr.cloud`) |
| Spec | KVM 2 — 2 vCPU, 8 GB RAM, 100 GB disk, Ubuntu 24.04 LTS |

The other two VPSs on the account are unrelated: `srv1651323` runs
openclaw + traefik, and `hackedu.tech` runs the hackedu Astro app.

Serving is **openresty** in front — the built web bundle is served as static
files and `/api` is proxied to the Hono API (unauthenticated `/api/me`
returns 401, which is the quickest liveness check). Responses carry
`X-Served-By: core.mapim.dev`.

**Do not** run `compose.yml` against this box expecting it to ship this
fork: it pulls `ghcr.io/usekaneo/kaneo:latest`, which is **upstream's**
image and does not contain this fork's code.

Hostinger's Docker Manager API cannot introspect this VPS — its OS template
is plain Ubuntu 24.04 rather than the Docker+Traefik template, so
`VPS_getProjectListV1` returns `[VPS:2044] ... does not support Docker
Manager`. That is an API limitation, **not** evidence that nothing is
running there. Probe the URL instead.

**Still undocumented: how code actually gets onto the box.** Whether that is
a git pull plus build, a compose stack, an rsync of `dist`, or something
triggered by hand is not recorded anywhere in this repo, and no credentials
for the box exist in this working copy. Ask, then write the answer here.

Remember migrations run on API startup, so any deploy that restarts the API
applies pending drizzle migrations to production data.

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
