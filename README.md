# huddle

Open source team chat you can actually host yourself. Channels, threads, files, voice notes and search that works.

One container, one Postgres, one bucket. No vendor account required, nothing proprietary in the stack, and no third party request from the browser at runtime.

## Run it

```bash
cp .env.example .env
docker compose up
```

Open http://localhost:3000. With no SMTP server configured, sign in links are printed to the app container's log, which is enough to get in and look around:

```bash
docker compose logs -f app | grep email_not_sent
```

Set `SMTP_URL` when you want real email, and the S3 variables when you want file uploads and voice notes to work. Everything else has a working default.

## What you need

| Piece                   | Why                                                 | Options                                                                      |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Postgres 15 or newer    | Everything, including messages, sessions and search | The bundled container, RDS, Neon, Supabase, your own                         |
| An S3 compatible bucket | Attachments and voice notes                         | AWS S3, Cloudflare R2, Backblaze B2, Wasabi, Spaces, a MinIO you already run |
| SMTP, optional          | Sign in links                                       | Any relay. Without it, links go to the log                                   |

Nothing here is specific to one cloud. `S3_ENDPOINT` empty means AWS, anything else points at the gateway you prefer.

## Configuration

Every setting is an environment variable, read once at boot. See [`.env.example`](.env.example) for the full list with comments. The two that matter:

```
DATABASE_URL=postgres://user:password@host:5432/huddle
PUBLIC_URL=https://chat.example.com
```

`PUBLIC_URL` is the origin sign in links point back at, so it has to be the address people actually use.

### The bucket

Uploads go straight from the browser to the bucket, so the bucket has to allow
that. This is the one setting that fails invisibly: every server side call
works, presigning works, and only the browser sees the upload refused. huddle
warns about it at boot, but it has to be fixed on the bucket.

```json
[
  {
    "AllowedOrigins": ["https://chat.example.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

```bash
aws s3api put-bucket-cors --bucket huddle --cors-configuration file://cors.json
```

`AllowedOrigins` must be exactly your `PUBLIC_URL`. The same shape works on R2,
B2, Wasabi and MinIO.

Get `S3_REGION` right too, or presigned URLs answer 301 forever: a signature is
bound to the region it was made for and cannot follow a redirect. huddle reads
the real region from the bucket at boot and logs the correction, so check the
log if uploads misbehave.

### Notifications

huddle installs from the browser and sends real push, with no app store account on either side. Generate a key pair once and put it in the environment:

```bash
pnpm --filter @huddle/server exec web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

The toggle appears in the sidebar once the server has a pair. Push needs HTTPS everywhere except `localhost`, and on an iPhone the app has to be added to the home screen first, which is Apple's rule rather than ours.

### End to end encryption

Direct messages and private channels are encrypted in the browser. The server
stores ciphertext, and cannot read a message even under its own database
credentials.

One symmetric key per channel per epoch, sealed to each member's devices:
ECDH P-256 with an ephemeral key pair for the agreement, ECDSA P-256 over every
sealed key, HKDF-SHA-256 to derive, and AES-256-GCM for content. A message is
bound to its channel, its id, its author and its key epoch as associated data,
so a ciphertext cannot be moved to another channel, replayed as a different
message, or reattributed to somebody who did not write it.

Keys are made in the browser and never leave it. The private halves are
generated non extractable and kept in IndexedDB as `CryptoKey` objects, so page
code can ask the browser to use them and cannot read them out. A new device
holds nothing until somebody already in the channel opens it and seals the key
across.

Removing somebody moves the channel to a new key. What they already read stays
readable to them, which no design can prevent, and everything said afterwards
is beyond the key they hold.

The costs are real and are the point:

- Search covers your open channels. There is no text to index in an encrypted one.
- The assistant will not summarise an encrypted channel. There is nothing to send it.
- A push notification says a message arrived, not what it said.

Public channels are not encrypted, and keep search and the assistant. Choose
per channel when you make one; it cannot be turned on afterwards, because that
would leave a scrollback of plaintext behind a claim of privacy.

### Huddles

Voice, camera and screen sharing, in any channel or conversation. Nothing to
configure and no media server: the browsers connect to each other directly and
this process only says who is in the call and passes the descriptions between
them.

That is a mesh, so each person sends one copy of their camera to every other
person. It is capped at eight, which is roughly where a normal home connection
stops keeping up. A room larger than that needs a server that forwards streams,
and that is a second service, so it is deliberately not here.

Calls work as they are on a LAN or an open network. What they cannot cross on
their own is a strict NAT, where neither end is reachable from outside. For
that, point huddle at a relay of your own:

```
TURN_URLS=turn:relay.example.com:3478
TURN_SECRET=...
```

With `TURN_SECRET` set, huddle mints each caller a credential that expires
within the hour, which is what coturn's `use-auth-secret` mode expects.
`TURN_USERNAME` and `TURN_PASSWORD` work instead if your relay uses a fixed
pair. There is no public STUN server configured by default, because a page
reaching out to somebody else's server is exactly what this project does not
do.

### AI, optional

Off unless configured. It powers two things: summarising a thread, and telling
you what you missed since your own read position. Nothing is stored, and no
message content leaves the deployment while these are empty.

Any OpenAI compatible endpoint works, including a local Ollama:

```
AI_BASE_URL=https://api.fireworks.ai/inference/v1
AI_API_KEY=...
AI_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731
```

The base URL must include the version path, because `/chat/completions` is
appended to it. Providers usually serve dated snapshots rather than a rolling
name, so huddle checks the model against the provider at boot and logs what is
actually reachable if the configured one is not.

## Deploy

**Docker Compose.** The file in this repo. One app container, one Postgres, one named volume.

**Railway, Render, Coolify, Fly.** Point them at this repo's Dockerfile, attach a Postgres, set `DATABASE_URL`, `PUBLIC_URL` and the S3 variables.

**Kubernetes.** A chart is in [`deploy/helm`](deploy/helm). The image is a single stateless process, so run as many replicas as you like: above one the chart sets `HUDDLE_CLUSTER=true`, which turns on the Postgres `LISTEN`/`NOTIFY` relay so instances see each other's realtime traffic. No Redis, and no sticky sessions, because a client reconnecting to any pod resumes from the sequence it holds.

**Bare metal.** `pnpm build` then `node apps/server/dist/main.js` with `WEB_DIR` pointing at `apps/web/build/client`.

Migrations run on boot, so an empty database becomes a working install with no second command.

## Develop

```bash
pnpm install
docker compose up db        # or point DATABASE_URL at any Postgres
cp .env.example .env
pnpm dev
```

The API listens on :3000 and the client dev server on :5173, which proxies `/api` and `/auth` across. In production they are one origin.

```bash
pnpm test         # vitest against a real Postgres, in process, no container
pnpm typecheck
pnpm lint
pnpm build
```

The test suite runs on [PGlite](https://pglite.dev), so row locks, `jsonb` and full text search behave exactly as they will in production and nothing has to be running first.

## How it fits together

```
apps/server     the process: client bundle, /api, and the WebSocket on one port
apps/web        React Router SPA, static build
packages/core   types, zod schemas, the wire protocol
packages/db     drizzle schema and migrations
packages/server services, routes, realtime hub, storage clients
packages/ui     design tokens, fonts, components
```

A call is a roster in Postgres and a relay over the same socket everything else
uses. No media passes through the server, which is why huddles cost it almost
nothing and why they need no service of their own.

Message order comes from a per channel sequence number claimed inside the same transaction that writes the message, so ordering holds no matter how many instances are running. Clients reconnect by sending the last sequence they hold and receiving the delta, which is the same code path that covers a backgrounded phone and a dropped connection.

## Licence

MIT.
