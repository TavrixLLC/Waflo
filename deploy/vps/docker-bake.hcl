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
    "operational-worker",
    "wallet-worker",
    "merchant-staging",
    "customer-staging",
    "marketing-staging",
    "merchant-production",
    "customer-production",
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

target "_production-build" {
  inherits = ["_common"]
  cache-from = ["type=gha,scope=waflo-release-production"]
  cache-to   = ["type=gha,mode=max,scope=waflo-release-production"]
  args = {
    DEPLOYMENT_ENVIRONMENT          = "production"
    NEXT_PUBLIC_API_URL             = "https://api.waflo.app"
    NEXT_PUBLIC_DASHBOARD_URL       = "https://app.waflo.app"
    NEXT_PUBLIC_MARKETING_URL       = "https://waflo.app"
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = MAPBOX_PRODUCTION_PUBLIC_TOKEN
  }
}

target "_staging-build" {
  inherits = ["_common"]
  cache-from = [
    "type=gha,scope=waflo-release-staging",
    "type=gha,scope=waflo-release-production",
  ]
  cache-to = ["type=gha,mode=max,scope=waflo-release-staging"]
  args = {
    DEPLOYMENT_ENVIRONMENT          = "staging"
    NEXT_PUBLIC_API_URL             = "https://api-staging.waflo.app"
    NEXT_PUBLIC_DASHBOARD_URL       = "https://app-staging.waflo.app"
    NEXT_PUBLIC_MARKETING_URL       = "https://staging.waflo.app"
    NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = MAPBOX_STAGING_PUBLIC_TOKEN
  }
}

# API, workers, and migration receive environment configuration only at runtime.
# Each target is built once and its identical manifest receives both Compose tags.
target "migrate" {
  inherits = ["_production-build"]
  target   = "migrate"
  tags = [
    "${IMAGE_REGISTRY}/waflo-migrate:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-migrate:${RELEASE_SHA}-production",
  ]
}

target "api" {
  inherits = ["_production-build"]
  target   = "api"
  tags = [
    "${IMAGE_REGISTRY}/waflo-api:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-api:${RELEASE_SHA}-production",
  ]
}

target "operational-worker" {
  inherits = ["_production-build"]
  target   = "operational-worker"
  tags = [
    "${IMAGE_REGISTRY}/waflo-operational-worker:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-operational-worker:${RELEASE_SHA}-production",
  ]
}

target "wallet-worker" {
  inherits = ["_production-build"]
  target   = "wallet-worker"
  tags = [
    "${IMAGE_REGISTRY}/waflo-wallet-worker:${RELEASE_SHA}-staging",
    "${IMAGE_REGISTRY}/waflo-wallet-worker:${RELEASE_SHA}-production",
  ]
}

target "merchant-staging" {
  inherits = ["_staging-build"]
  target   = "merchant-web"
  tags     = ["${IMAGE_REGISTRY}/waflo-merchant:${RELEASE_SHA}-staging"]
}

target "customer-staging" {
  inherits = ["_staging-build"]
  target   = "customer-web"
  tags     = ["${IMAGE_REGISTRY}/waflo-customer:${RELEASE_SHA}-staging"]
}

target "marketing-staging" {
  inherits = ["_staging-build"]
  target   = "marketing-web"
  tags     = ["${IMAGE_REGISTRY}/waflo-marketing:${RELEASE_SHA}-staging"]
}

target "merchant-production" {
  inherits = ["_production-build"]
  target   = "merchant-web"
  tags     = ["${IMAGE_REGISTRY}/waflo-merchant:${RELEASE_SHA}-production"]
}

target "customer-production" {
  inherits = ["_production-build"]
  target   = "customer-web"
  tags     = ["${IMAGE_REGISTRY}/waflo-customer:${RELEASE_SHA}-production"]
}

target "marketing-production" {
  inherits = ["_production-build"]
  target   = "marketing-web"
  tags     = ["${IMAGE_REGISTRY}/waflo-marketing:${RELEASE_SHA}-production"]
}
