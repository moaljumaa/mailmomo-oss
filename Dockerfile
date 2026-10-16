# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data PORT=3000
# Infisical CLI, pinned: secrets are fetched at container boot by docker-entrypoint.sh
ARG INFISICAL_CLI_VERSION=0.43.5
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates   && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash   && apt-get update && apt-get install -y --no-install-recommends infisical=${INFISICAL_CLI_VERSION}*   && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp
RUN useradd -r -u 1001 mailmomo && mkdir /data && chown mailmomo /data
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=build --chown=mailmomo /app/.next ./.next
COPY --from=build --chown=mailmomo /app/node_modules ./node_modules
COPY --from=build --chown=mailmomo /app/package.json ./package.json
COPY --from=build --chown=mailmomo /app/next.config.ts ./next.config.ts
COPY --from=build --chown=mailmomo /app/public ./public
USER mailmomo
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npx", "next", "start", "-p", "3000"]
