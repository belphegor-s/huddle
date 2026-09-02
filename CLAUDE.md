# huddle

Open source team chat. Channels, threads, files, voice notes, search, huddles, AI. Mobile first, self hostable, one container plus a Postgres.

## Hard rules

These are not preferences. Violating any of them is a bug.

1. **No em dashes anywhere in the repo.** Not in code, comments, docs, UI copy, commit messages, or JSON. Use a comma, a colon, parentheses, or a full stop. CI enforces this via `pnpm check:dashes`.
2. **Commits never credit an AI.** No `Co-Authored-By: Claude`, no "generated with" trailers, no AI mention in the body. Conventional Commits format, human voice.
3. **No indirection for its own sake.** There is one database, one object store, one realtime hub, and the code calls them directly. Do not add an interface with a single implementation, a plugin layer, or a driver abstraction. Portability comes from choosing boring standard pieces, not from wrapping them.
4. **Standard pieces only.** Postgres, an S3 compatible bucket, SMTP, an OpenAI compatible endpoint. Nothing that exists on exactly one cloud. If a feature needs a proprietary service, it does not go in.
5. **A deploy is one container.** The process serves the client, the API and the WebSocket on one port. Anything that would add a service to `docker-compose.yml` needs to justify why the app cannot do it, and the answer is usually that it can.
6. **Privacy by default.** No third party requests from the client at runtime. Fonts, icons, and scripts are self hosted. No analytics, no trackers, no CDN calls. AI is off until a key is set. Telemetry, if ever added, is opt in and off by default.
7. **Comments only where the code cannot speak.** Explain a non obvious why, a protocol constraint, a workaround with a link. Never narrate what the next line does. No section banners, no decorative dividers.

## Architecture

```
apps/
  server/             The deployable process. Serves the client, /api, and the WebSocket on one port.
  web/                React Router SPA. Static bundle, talks to the API over fetch and one socket.
packages/
  core/               Types, zod schemas, wire protocol, ID generation. Zero dependencies on anything.
  db/                 Drizzle schema, migrations, and the Postgres connection.
  server/             Services, HTTP routes, realtime hub, storage clients. The whole backend.
  ui/                 Design tokens, fonts, components. Owned in repo, not a dependency.
```

**One process, one origin.** `apps/server` serves the built client from `WEB_DIR`, mounts the Hono app at `/api` and `/auth`, and upgrades `/api/realtime` to a WebSocket. Same origin means the session cookie works with no CORS and no second hostname to configure.

**The client is a static bundle.** `ssr: false`, with `/` prerendered so a link preview and a search engine see the landing page. Loaders are `clientLoader` and call the API. There is no server side React anywhere, which is why the runtime image has no `node_modules`.

**Services take an `AppContext`.** One object holding the database, the hub, the bucket, the mailer, the AI client and the clock. It is a parameter, not a container: services are plain functions and tests build the context directly.

**Message ordering** comes from a monotonic `seq` per channel, claimed by `UPDATE channels SET last_seq = last_seq + 1 RETURNING last_seq` inside the transaction that inserts the message. The row lock serialises concurrent sends per channel, so ordering holds across as many app instances as you run. Clients reconnect by sending their last seen `seq` and receiving the delta. That single mechanism covers reconnect, backgrounded phones, and flaky mobile networks identically. Do not add a second sync path.

**Realtime** is an in process hub: a map from channel to connected subscribers. Running more than one instance sets `HUDDLE_CLUSTER=true`, which adds a Postgres `LISTEN`/`NOTIFY` relay so instances see each other's traffic. No Redis. A message too large for a `NOTIFY` payload travels as a pointer and the receiving instance reads the row it already has.

**Every frame that changes anything** goes through the same service function the HTTP route calls. There is one place permission is decided and one place a message is written.

**Search** is Postgres full text: a GIN index on `to_tsvector('simple', text)` and `ts_headline` for snippets. The snippet carries control character markers rather than HTML, so message content can never become markup in the client.

**Uploads** never pass through the app. The server records the file and signs a PUT, the browser sends the bytes to the bucket, and downloads are a redirect to a signed GET. A permanent `/api/files/:id` link keeps working after the signed URL it points at has expired.

## Commands

```bash
pnpm dev              # api on :3000 and the client on :5173, proxied
pnpm build
pnpm typecheck
pnpm test             # vitest, real Postgres in process via PGlite
pnpm e2e              # playwright
pnpm lint
pnpm check:dashes     # em dash guard
pnpm db:generate      # drizzle migration from schema changes
```

`pnpm dev` needs a Postgres. `docker compose up db` is enough, or any local install, pointed at by `DATABASE_URL` in `.env`.

## Conventions

- TypeScript strict. No `any`, no `as unknown as`. If a type fights you, the design is wrong.
- Files stay small and single purpose. A file over roughly 300 lines is a signal to split.
- Zod schemas live in `packages/core` and are the single source of truth for both validation and types. Never hand write a type that a schema already describes.
- IDs are ULIDs, generated client side for optimistic sends, using `crypto.getRandomValues`. Never `Math.random`.
- Every workspace scoped read and write goes through `requireMember`, and every channel scoped one through `requireChannel`. There are exactly two such guards and every route passes through one.
- A private channel the caller is not in answers `not_found`, never `forbidden`. Confirming that it exists is itself the leak.
- Errors are typed results at service boundaries, exceptions only for genuinely exceptional cases.
- Tests run against PGlite, which is real Postgres. Do not introduce a fake database: row locks, `jsonb` and full text search are exactly where the bugs are.

## Design

Native feel is the bar, not "nice for a web app". Judge every interaction against the platform's own apps.

- Type: Switzer for UI, Bricolage Grotesque for display and landing, Commit Mono for code. Self hosted woff2, subset, `font-display: swap`.
- Motion is functional. Layout transitions, optimistic send settling, sheet springs, gesture follow through. Nothing decorative, nothing that delays input.
- Respect `prefers-reduced-motion` everywhere, with a real static fallback rather than a disabled animation.
- Dark mode is designed, not inverted.
- Mobile: safe area insets, thumb reachable primary actions, 44px minimum targets, keyboard aware composer via `visualViewport`, no layout shift when the keyboard opens.
- On a phone the channel list and the conversation are two screens, not a drawer. Every gesture has a visible non gesture fallback. A first time user must never need to discover a swipe.
- Copy is plain and short. No exclamation marks, no marketing voice inside the product, no emoji in system text.

## Deploy targets

All of these are the same image.

1. `docker compose up`, app plus Postgres, bucket of your choosing.
2. Railway, Render, Coolify, Fly: one container, `DATABASE_URL` and the S3 variables.
3. Helm chart for existing Kubernetes clusters.
4. A plain `node dist/main.js` on a box you already have.

If a feature cannot work on all of them, it goes behind a capability flag and degrades cleanly, with the limitation documented.
