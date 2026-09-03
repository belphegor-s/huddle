# One image, one process. It serves the client bundle, the API and the
# WebSocket on a single port, so a deploy is this container plus a Postgres
# and an S3 bucket you already have.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifests first, so a source change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app

# The bundle carries its dependencies, so the runtime image has no node_modules
# and nothing to audit beyond Node itself.
COPY --from=build /repo/apps/server/dist/main.js ./dist/main.js
COPY --from=build /repo/apps/server/migrations ./migrations
COPY --from=build /repo/apps/web/build/client ./web

ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIR=/app/web

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
