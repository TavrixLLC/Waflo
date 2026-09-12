variable "IMAGE_REGISTRY" {
  default = "local"
}

variable "RELEASE_SHA" {
  default = "unknown"
}

variable "OCI_SOURCE" {
  default = "https://github.com/REPLACE_WITH_OWNER/REPLACE_WITH_REPOSITORY"
}

variable "OCI_CREATED" {
  default = "1970-01-01T00:00:00Z"
}

variable "IMAGE_PLATFORM" {
  default = "linux/amd64"
}

variable "MAPBOX_PRODUCTION_PUBLIC_TOKEN" {
  default = ""
}

variable "MAPBOX_STAGING_PUBLIC_TOKEN" {
  default = ""
}

group "release" {
  targets = [
    "migrate",
    "api",
    "apple-pass-builder",
    "operational-worker",
    "wallet-worker",
    "merchant-staging",
    "customer-staging",
    "admin-staging",
    "marketing-staging",
    "merchant-production",
    "customer-production",
    "admin-production",
    "marketing-production",
  ]
}

target "_common" {
  context    = "."
  dockerfile = "deploy/vps/Dockerfile"
  platforms  = [IMAGE_PLATFORM]
  args = {
    RELEASE_SHA = RELEASE_SHA
  }
  labels = {
    "org.opencontainers.image.created"  = OCI_CREATED
    "org.opencontainers.image.revision" = RELEASE_SHA
    "org.opencontainers.image.source"   = OCI_SOURCE
    "org.opencontainers.image.version"  = RELEASE_SHA
  }
  attest = [
    "type=provenance,mode=max",
    "type=sbom",
  ]
}

target "_runtime-build" {
  inherits = ["_common"]
  # API, workers, and migrations share one production-configured Node build.
  # Keep it separate from web and Swift caches so unrelated target updates do
  # not replace their cache records. The old scope remains a read-only bridge
  # while new trusted release runs populate the narrower scope.
  cache-from = [
    "type=gha,scope=waflo-release-node-runtime",
    "type=gha,scope=waflo-release-production",
  ]
  cache-to = ["type=gha,mode=max,scope=waflo-release-node-runtime"]
  args = {
    DEPLOYMENT_ENVIRONMENT          = "production"
    NEXT_PUBLIC_API_URL             = "https://api.waflo.app"
    NEXT_PUBLIC_DASHBOARD_URL       = "https://app.waflo.app"
    NEXT_PUBLIC_MARKETING_URL       = "https://waflo.app"
    NEXT_PUBLIC_CUSTOMER_URL        = "https://card.waflo.app"
    NEXT_PUBLIC_ADMIN_URL           = "https://admin.waflo.app"
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = MAPBOX_PRODUCTION_PUBLIC_TOKEN
  }
}

target "_staging-web-build" {
  inherits = ["_common"]
  cache-from = [
    "type=gha,scope=waflo-release-web-staging",
    "type=gha,scope=waflo-release-node-runtime",
    "type=gha,scope=waflo-release-staging",
    "type=gha,scope=waflo-release-production",
  ]
  cache-to = ["type=gha,mode=max,scope=waflo-release-web-staging"]
  args = {
    DEPLOYMENT_ENVIRONMENT          = "staging"
    NEXT_PUBLIC_API_URL             = "https://api-staging.waflo.app"
    NEXT_PUBLIC_DASHBOARD_URL       = "https://app-staging.waflo.app"
    NEXT_PUBLIC_MARKETING_URL       = "https://staging.waflo.app"
    NEXT_PUBLIC_CUSTOMER_URL        = "https://card-staging.waflo.app"
    NEXT_PUBLIC_ADMIN_URL           = "https://admin-staging.waflo.app"
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = MAPBOX_STAGING_PUBLIC_TOKEN
  }
}

target "_production-web-build" {
  inherits = ["_common"]
  cache-from = [
    "type=gha,scope=waflo-release-web-production",
    "type=gha,scope=waflo-release-node-runtime",
    "type=gha,scope=waflo-release-production",
  ]
  cache-to = ["type=gha,mode=max,scope=waflo-release-web-production"]
  args = {
    DEPLOYMENT_ENVIRONMENT          = "production"
    NEXT_PUBLIC_API_URL             = "https://api.waflo.app"
    NEXT_PUBLIC_DASHBOARD_URL       = "https://app.waflo.app"
    NEXT_PUBLIC_MARKETING_URL       = "https://waflo.app"
    NEXT_PUBLIC_CUSTOMER_URL        = "https://card.waflo.app"
    NEXT_PUBLIC_ADMIN_URL           = "https://admin.waflo.app"
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = MAPBOX_PRODUCTION_PUBLIC_TOKEN
  }
}

# API, workers, and migration receive environment configuration only at runtime.
# Each target is built once and its identical manifest receives both Compose tags.
target "migrate" {
  inherits = ["_runtime-build"]
  target   = "migrate"
  args = { BUILD_SCOPE = "@waflo/deployment-migrate..." }
  tags = [
    "${IMAGE_REGISTRY}/waflo-migrate:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-migrate:${RELEASE_SHA}-production",
  ]
}

target "api" {
  inherits = ["_runtime-build"]
  target   = "api"
  args = { BUILD_SCOPE = "@waflo/api..." }
  tags = [
    "${IMAGE_REGISTRY}/waflo-api:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-api:${RELEASE_SHA}-production",
  ]
}

target "apple-pass-builder" {
  inherits   = ["_common"]
  dockerfile = "apps/apple-pass-builder-service/Dockerfile"
  cache-from = ["type=gha,scope=waflo-release-apple-pass-builder"]
  cache-to   = ["type=gha,mode=max,scope=waflo-release-apple-pass-builder"]
  tags = [
    "${IMAGE_REGISTRY}/waflo-apple-pass-builder:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-apple-pass-builder:${RELEASE_SHA}-production",
  ]
}

target "operational-worker" {
  inherits = ["_runtime-build"]
  target   = "operational-worker"
  args = { BUILD_SCOPE = "@waflo/operational-worker..." }
  tags = [
    "${IMAGE_REGISTRY}/waflo-operational-worker:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-operational-worker:${RELEASE_SHA}-production",
  ]
}

target "wallet-worker" {
  inherits = ["_runtime-build"]
  target   = "wallet-worker"
  args = { BUILD_SCOPE = "@waflo/wallet-worker..." }
  tags = [
    "${IMAGE_REGISTRY}/waflo-wallet-worker:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-wallet-worker:${RELEASE_SHA}-production",
  ]
}

target "merchant-staging" {
  inherits = ["_staging-web-build"]
  target   = "merchant-web"
  args     = { BUILD_SCOPE = "@waflo/merchant-dashboard..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-merchant:${RELEASE_SHA}-staging"]
}

target "customer-staging" {
  inherits = ["_staging-web-build"]
  target   = "customer-web"
  args     = { BUILD_SCOPE = "@waflo/customer-web..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-customer:${RELEASE_SHA}-staging"]
}

target "admin-staging" {
  inherits = ["_staging-web-build"]
  target   = "admin-web"
  args     = { BUILD_SCOPE = "@waflo/admin-dashboard..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-admin:${RELEASE_SHA}-staging"]
}

target "marketing-staging" {
  inherits = ["_staging-web-build"]
  target   = "marketing-web"
  args     = { BUILD_SCOPE = "@waflo/marketing-web..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-marketing:${RELEASE_SHA}-staging"]
}

target "merchant-production" {
  inherits = ["_production-web-build"]
  target   = "merchant-web"
  args     = { BUILD_SCOPE = "@waflo/merchant-dashboard..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-merchant:${RELEASE_SHA}-production"]
}

target "customer-production" {
  inherits = ["_production-web-build"]
  target   = "customer-web"
  args     = { BUILD_SCOPE = "@waflo/customer-web..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-customer:${RELEASE_SHA}-production"]
}

target "admin-production" {
  inherits = ["_production-web-build"]
  target   = "admin-web"
  args     = { BUILD_SCOPE = "@waflo/admin-dashboard..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-admin:${RELEASE_SHA}-production"]
}

target "marketing-production" {
  inherits = ["_production-web-build"]
  target   = "marketing-web"
  args     = { BUILD_SCOPE = "@waflo/marketing-web..." }
  tags     = ["${IMAGE_REGISTRY}/waflo-marketing:${RELEASE_SHA}-production"]
}
