# scriptorium

scriptorium is a searchable frontend tooling catalog built as:

- a Vite React frontend in `src/`
- shared catalog contracts in `shared/`
- Turso/libSQL-backed catalog services in `server/`
- a Cloudflare Worker API in `worker/`

The production target is Cloudflare Pages for the frontend plus a separate Cloudflare Worker for `/api/search` and `/api/tags`, with Turso as the source of truth.

## Local development

Install dependencies with `pnpm install`.

Run the frontend:

```bash
pnpm dev
```

Run the API locally:

```bash
pnpm dev:worker
```

This starts a Node-based local server on `http://127.0.0.1:8787` and uses `.data/scriptorium.db` automatically when `TURSO_DATABASE_URL` is unset.
If you specifically need to run the Cloudflare Worker runtime in development, use:

```bash
pnpm dev:worker:cf
```

If you need to prepare or migrate the database schema without starting the worker:

```bash
pnpm db:prepare
```

To destructively reset the catalog and recreate the current schema:

```bash
pnpm db:reset
```

Point the frontend at the API during local development with:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
```

If `TURSO_DATABASE_URL` is not set for scripts and tests, scriptorium falls back to a local libSQL database at `.data/scriptorium.db`.
For an existing Turso or local database created before the current schema, run `pnpm db:reset` once before using the worker.

## API

The public read API is:

- `GET /api/search?q&tags&source&limit&cursor`
- `GET /api/tags?source`

## Admin sync commands

- `pnpm import:algolia-packages -- "react framework"`
- `pnpm sync:ecosystems-popular`
- `pnpm sync:npm-metadata`
- `pnpm sync:github-metadata`

These commands update the database directly. They do not generate repo data files or commit changes.

## Build and validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:app
pnpm build:worker
```

## Environment variables

- `VITE_API_BASE_URL`: frontend API origin override for local or split-origin deployments
- `TURSO_DATABASE_URL`: Turso/libSQL database URL for the worker and sync scripts
- `TURSO_AUTH_TOKEN`: Turso auth token when using remote Turso
- `GITHUB_TOKEN`: optional GitHub API token for GitHub metadata sync
- `ECOSYSTEMS_BASE_URL`: optional ecosyste.ms API override, defaults to `https://packages.ecosyste.ms/api/v1`
- `ECOSYSTEMS_SYNC_LIMIT`: optional total number of ecosyste.ms npm packages to sync, defaults to `1000`
- `GITHUB_API_BASE_URL`: optional GitHub API override, defaults to `https://api.github.com`
- `NPM_REGISTRY_BASE_URL`: optional npm registry override, defaults to `https://registry.npmjs.org`
- `SCRIPTORIUM_USER_AGENT`: optional user agent for ecosyste.ms sync
- `SCRIPTORIUM_DATA_DIR`: optional local fallback database directory
