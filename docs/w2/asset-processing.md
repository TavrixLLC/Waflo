# Asset processing

Merchant uploads accept PNG, JPEG, and WebP only. SVG and external URLs are rejected. The API enforces a 2 MB decoded payload limit, checks magic bytes against the declared MIME type, normalizes filenames, scopes object keys by organization and asset ID, deduplicates by SHA-256, and records safe metadata. Local development writes to `tmp/waflo-assets`; a provider abstraction remains the deployment seam.
