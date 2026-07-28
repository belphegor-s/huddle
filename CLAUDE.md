# huddle

Open source team chat. Channels, threads, files, voice notes, search, huddles, AI. Mobile first, self hostable, runs at zero cost on Cloudflare free tier.

## Hard rules

These are not preferences. Violating any of them is a bug.

1. **No em dashes anywhere in the repo.** Not in code, comments, docs, UI copy, commit messages, or JSON. Use a comma, a colon, parentheses, or a full stop. CI enforces this via `pnpm check:dashes`.
2. **Commits never credit an AI.** No `Co-Authored-By: Claude`, no "generated with" trailers, no AI mention in the body. Conventional Commits format, human voice.
3. **No vendor lock-in.** Nothing outside `packages/adapter-*` may import a platform SDK. Domain and API layers talk to ports only. If you reach for `env.MY_DO` in a route handler, stop and add a port method instead.
4. **Cost is a design constraint.** Default configuration must stay inside the Cloudflare free tier for a small team. Anything that scales per message (queues, AI calls, image transforms) needs an inline or batched fallback that costs nothing.
5. **Privacy by default.** No third party requests from the client at runtime. Fonts, icons, and scripts are self hosted. No analytics, no trackers, no CDN calls. Telemetry, if ever added, is opt in and off by default.
6. **Comments only where the code cannot speak.** Explain a non obvious why, a protocol constraint, a workaround with a link. Never narrate what the next line does. No section banners, no decorative dividers.

## Architecture

Ports and adapters. The domain does not know what platform it runs on.

```
apps/
  web/                React Router v7 PWA, and the Cloudflare Worker that serves both it and /api. Wires adapter-cloudflare.
  server/             Node entry for self hosting, wires adapter-node
packages/
  core/               Types, zod schemas, wire protocol, ID generation. Zero dependencies on anything.
  domain/             Ports (interfaces) and use cases. Pure. Fully unit testable with fakes.
  api/                Hono routes and middleware, written against ports. Runs unchanged on both entries.
  db/                 Drizzle schema and migrations. SQLite dialect only.
  ui/                 Design tokens, fonts, components. Owned in repo, not a dependency.
  adapter-cloudflare/ Durable Objects, D1, R2, KV, Queues, Workers AI.
  adapter-node/       libSQL, filesystem or S3 compatible blobs, in process pubsub, optional Redis.
```

**One origin per deploy.** The app and the API are served by a single Worker on Cloudflare and a single process on Node. A split would force CORS, break the session cookie, and double the request count against the free tier. `apps/web/workers/app.ts` routes `/api/*` into `packages/api` and everything else into React Router.

**SQLite is the only dialect.** D1 on Cloudflare, libSQL or better-sqlite3 when self hosted. One schema, one migration set, both backends. This is deliberate and should not be traded away for Postgres without a very strong reason.

**Realtime** is the one thing implemented twice, because it has to be. Cloudflare uses a `ChannelRoom` Durable Object with the WebSocket Hibernation API, which gives single writer ordering for free. Node uses an in process WebSocket hub, with Redis pub/sub only when running more than one instance. Both satisfy the same `RealtimeHub` port and the same wire protocol, so the client cannot tell them apart.

**Message ordering** comes from a monotonic `seq` per channel. Clients reconnect by sending their last seen `seq` and receiving the delta. That single mechanism covers reconnect, backgrounded phones, and flaky mobile networks identically. Do not add a second sync path.

## Commands

```bash
pnpm dev              # everything, local, no cloud account needed
pnpm build
pnpm typecheck
pnpm test             # vitest, workers pool for the cloudflare adapter
pnpm e2e              # playwright
pnpm lint
pnpm check:dashes     # em dash guard
pnpm db:generate      # drizzle migration from schema changes
```

## Conventions

- TypeScript strict. No `any`, no `as unknown as`. If a type fights you, the design is wrong.
- Files stay small and single purpose. A file over roughly 300 lines is a signal to split.
- Zod schemas live in `packages/core` and are the single source of truth for both validation and types. Never hand write a type that a schema already describes.
- IDs are ULIDs, generated client side for optimistic sends, using `crypto.getRandomValues`. Never `Math.random`.
- Every DB query is workspace scoped through `requireMember`. There is exactly one such guard and every route passes through it.
- Errors are typed results at domain boundaries, exceptions only for genuinely exceptional cases.
- Run `wrangler types` rather than hand writing an `Env` interface.

## Design

Native feel is the bar, not "nice for a web app". Judge every interaction against the platform's own apps.

- Type: Switzer for UI, Bricolage Grotesque for display and landing, Commit Mono for code. Self hosted woff2, subset, `font-display: swap`.
- Motion is functional. Layout transitions, optimistic send settling, sheet springs, gesture follow through. Nothing decorative, nothing that delays input.
- Respect `prefers-reduced-motion` everywhere, with a real static fallback rather than a disabled animation.
- Dark mode is designed, not inverted.
- Mobile: safe area insets, thumb reachable primary actions, 44px minimum targets, keyboard aware composer via `visualViewport`, no layout shift when the keyboard opens.
- Every gesture has a visible non gesture fallback. A first time user must never need to discover a swipe.
- Copy is plain and short. No exclamation marks, no marketing voice inside the product, no emoji in system text.

## Deploy targets

All four are first class and tested before a release.

1. Deploy to Cloudflare button, zero cost for a small team.
2. `docker compose up`, app plus SQLite plus MinIO, for self hosting and air gapped installs.
3. Railway, Render, and Coolify templates.
4. Helm chart for existing Kubernetes clusters.

If a feature cannot work on all four, it goes behind a capability flag and degrades cleanly, with the limitation documented.
