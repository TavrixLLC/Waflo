# syntax=docker/dockerfile:1.8
FROM swift:6.3-noble@sha256:56ef1be2c1ca36f4c52440357dc1fcdfdb5e113587134fcadeef57c225c71b54 AS pass-builder-build

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /source/pass-builder
COPY apps/apple-pass-builder-service/patches/8908b955-swift-6.3-linux-pointer.patch /tmp/pass-builder.patch
RUN git init \
    && git remote add origin https://github.com/apple/pass-builder.git \
    && git fetch --depth 1 origin 8908b955a42da8294ce7506719aa1f186d096c02 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "8908b955a42da8294ce7506719aa1f186d096c02" \
    && git apply --check /tmp/pass-builder.patch \
    && git apply /tmp/pass-builder.patch
RUN swift package resolve \
    && echo "e1ebbb0c0b7c7d75a278cf3280b91bf2baad0c07700663671e56151310bccd52  Package.resolved" \
      | sha256sum --check --strict
RUN --mount=type=cache,target=/source/pass-builder/.build \
    swift build -c release --product buildpass --static-swift-stdlib --disable-automatic-resolution \
    && mkdir -p /out/runtime /out/Protobufs \
    && cp .build/release/buildpass /out/runtime/buildpass \
    && cp Package.resolved /out/runtime/Package.resolved \
    && cp LICENSE.txt /out/runtime/LICENSE.pass-builder.txt \
    && find .build/release -maxdepth 1 -type d -name '*.resources' -exec cp -R '{}' /out/runtime/ \; \
    && cp Protobufs/*.proto /out/Protobufs/

FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node-build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @waflo/apple-pass-builder-service...
RUN pnpm --filter @waflo/apple-pass-builder-service build \
    && pnpm --filter @waflo/apple-pass-builder-service deploy --prod --legacy /out/service

FROM ubuntu:noble@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517 AS runtime
LABEL org.opencontainers.image.source="https://github.com/apple/pass-builder" \
      io.waflo.pass-builder.revision="8908b955a42da8294ce7506719aa1f186d096c02" \
      io.waflo.pass-builder.compatibility-patch="8908b955-swift-6.3-linux-pointer.patch"
COPY --from=node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df /usr/local/ /usr/local/
RUN apt-get update \
    && apt-get install -y --no-install-recommends zip ca-certificates openssl libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 passbuilder \
    && useradd --system --uid 10001 --gid passbuilder --home-dir /nonexistent --shell /usr/sbin/nologin passbuilder

COPY --from=pass-builder-build --chown=root:root /out/runtime/ /opt/pass-builder/
COPY --from=pass-builder-build --chown=root:root /out/Protobufs/ /opt/pass-builder/Protobufs/
COPY --from=node-build --chown=root:root /out/service/ /opt/waflo/service/
COPY --chown=root:root apps/apple-pass-builder-service/THIRD_PARTY_NOTICES.md /opt/pass-builder/THIRD_PARTY_NOTICES.md
RUN chown -R 10001:10001 /opt/waflo/service/templates

ENV NODE_ENV=production \
    PASS_BUILDER_EXECUTABLE=/opt/pass-builder/buildpass \
    PASS_BUILDER_OPENSSL_EXECUTABLE=/usr/bin/openssl \
    PASS_BUILDER_PROTOBUF_ROOT=/opt/pass-builder/Protobufs \
    PASS_BUILDER_TEMPLATE_ROOT=/opt/waflo/service/templates \
    PASS_BUILDER_HOST=0.0.0.0 \
    PASS_BUILDER_PORT=8080
WORKDIR /opt/waflo/service
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
