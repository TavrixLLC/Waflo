# Object Storage and Image Processing Evidence

## Active storage architecture

- `S3ObjectStorage` is injected through the `OBJECT_STORAGE` token.
- Local development uses the S3-compatible MinIO service.
- Production uses the same S3-compatible adapter with environment-provided endpoint, region, bucket, and credentials.
- The API initializes and verifies the bucket before serving traffic.
- Health readiness includes object storage.
- Assets and generated previews use organization-scoped server keys through the abstraction.
- Reads go through the authenticated, tenant-authorized API content endpoint.
- Direct temporary-file display paths were removed from asset and preview services.
- Partial writes are deleted when processing or persistence fails.

Infrastructure proof:

- `raw-test-output/final-docker-compose-ps.log`
- `raw-test-output/final-minio-init.log`
- `raw-test-output/final-minio-private-probe.log` — anonymous bucket request returned `403`
- `raw-test-output/final-http.log` — authorized asset proxy returns content while anonymous storage access is denied

Production configuration rejects local/default storage credentials, insecure endpoints, or a local signing secret.

## Merchant-image processing

The multipart upload pipeline uses Sharp to:

- fully decode PNG, JPEG, and WebP;
- reject corrupt/truncated inputs;
- apply decoder pixel limits;
- normalize EXIF orientation;
- remove metadata through re-encoding;
- validate and apply crop/zoom geometry;
- preserve transparency where required;
- produce distinct `ORIGINAL_SAFE`, `STAMP_256`, and `THUMBNAIL_96` objects;
- calculate digest, dimensions, and sizes from processed bytes;
- avoid using the raw upload as a display variant;
- clean up storage and database partial writes on failure.

The Studio uploader provides crop/zoom controls, safe-area guidance, and resolution warnings.

Primary implementation:

- `apps/api/src/programs/image-processing.ts`
- `apps/api/src/programs/assets.service.ts`
- `apps/api/src/programs/assets.controller.ts`
- `apps/merchant-dashboard/components/program-asset-uploader.tsx`

Verification is included in unit/renderer, HTTP, concurrency, E2E, and accessibility suites.
