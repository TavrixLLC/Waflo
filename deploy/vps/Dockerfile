# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c

FROM ${NODE_IMAGE} AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:${PATH}
RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@11.5.2 --activate
WORKDIR /workspace

FROM toolchain AS dependencies
COPY . .
RUN --mount=type=cache,id=waflo-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DASHBOARD_URL
ARG NEXT_PUBLIC_MARKETING_URL
ARG NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_DASHBOARD_URL=${NEXT_PUBLIC_DASHBOARD_URL}
ENV NEXT_PUBLIC_MARKETING_URL=${NEXT_PUBLIC_MARKETING_URL}
ENV NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE=${NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE}
RUN DATABASE_URL=postgresql://build:build@invalid.invalid:5432/build?schema=public pnpm build

FROM build AS api-package
RUN pnpm --config.auto-install-peers=false --filter @waflo/api deploy --prod --legacy /output/api

FROM build AS operational-worker-package
RUN pnpm --config.auto-install-peers=false --filter @waflo/operational-worker deploy --prod --legacy /output/operational-worker

FROM build AS wallet-worker-package
RUN pnpm --config.auto-install-peers=false --filter @waflo/wallet-worker deploy --prod --legacy /output/wallet-worker

FROM build AS migration-package
RUN pnpm --filter @waflo/deployment-migrate deploy --prod --legacy /output/migrate
COPY packages/database/prisma /output/migrate/prisma

FROM ${NODE_IMAGE} AS runtime
ARG RELEASE_SHA=unknown
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.source="Waflo" \
      org.opencontainers.image.revision="${RELEASE_SHA}"
RUN groupadd --system --gid 10001 waflo && \
    useradd --system --uid 10001 --gid waflo --home-dir /app --shell /usr/sbin/nologin waflo

FROM runtime AS api
COPY --from=api-package --chown=waflo:waflo /output/api /app
WORKDIR /app
USER waflo
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM runtime AS operational-worker
COPY --from=operational-worker-package --chown=waflo:waflo /output/operational-worker /app
WORKDIR /app
USER waflo
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]

FROM runtime AS wallet-worker
COPY --from=wallet-worker-package --chown=waflo:waflo /output/wallet-worker /app
WORKDIR /app
USER waflo
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]

FROM runtime AS merchant-web
COPY --from=build --chown=waflo:waflo /workspace/apps/merchant-dashboard/.next/standalone /app
COPY --from=build --chown=waflo:waflo /workspace/apps/merchant-dashboard/.next/static /app/apps/merchant-dashboard/.next/static
COPY --from=build --chown=waflo:waflo /workspace/apps/merchant-dashboard/public /app/apps/merchant-dashboard/public
WORKDIR /app/apps/merchant-dashboard
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
USER waflo
EXPOSE 3001
CMD ["node", "server.js"]

FROM runtime AS customer-web
COPY --from=build --chown=waflo:waflo /workspace/apps/customer-web/.next/standalone /app
COPY --from=build --chown=waflo:waflo /workspace/apps/customer-web/.next/static /app/apps/customer-web/.next/static
COPY --from=build --chown=waflo:waflo /workspace/apps/customer-web/public /app/apps/customer-web/public
WORKDIR /app/apps/customer-web
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
USER waflo
EXPOSE 3002
CMD ["node", "server.js"]

FROM runtime AS marketing-web
COPY --from=build --chown=waflo:waflo /workspace/apps/marketing-web/.next/standalone /app
COPY --from=build --chown=waflo:waflo /workspace/apps/marketing-web/.next/static /app/apps/marketing-web/.next/static
COPY --from=build --chown=waflo:waflo /workspace/apps/marketing-web/public /app/apps/marketing-web/public
WORKDIR /app/apps/marketing-web
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
USER waflo
EXPOSE 3000
CMD ["node", "server.js"]

FROM toolchain AS migrate
ARG RELEASE_SHA=unknown
ENV NODE_ENV=production
ENV RELEASE_SHA=${RELEASE_SHA}
LABEL org.opencontainers.image.source="Waflo" \
      org.opencontainers.image.revision="${RELEASE_SHA}"
COPY --from=migration-package --chown=node:node /output/migrate /migration
USER node
WORKDIR /migration
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
