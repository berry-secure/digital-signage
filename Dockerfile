# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/cms/package.json apps/cms/package.json
COPY apps/player/package.json apps/player/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/server.js ./apps/server/server.js
COPY --from=build /app/apps/server/prisma.config.ts ./apps/server/prisma.config.ts
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/cms/dist ./apps/cms/dist
COPY --from=build /app/apps/cms/public ./apps/cms/public
COPY --from=build /app/apps/player/dist ./apps/player/dist

EXPOSE 3000
CMD ["sh", "-lc", "if [ -n \"$DATABASE_URL\" ]; then npm run prisma:migrate:deploy --workspace @ds/server; fi; npm run start:server"]
