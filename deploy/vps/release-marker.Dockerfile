FROM scratch

ARG RELEASE_SHA
ARG RELEASE_ENVIRONMENT

LABEL org.waflo.release.verified="true" \
      org.waflo.release.sha="${RELEASE_SHA}" \
      org.waflo.release.environment="${RELEASE_ENVIRONMENT}"

COPY deploy/vps/fixtures/release-marker.txt /release-marker
