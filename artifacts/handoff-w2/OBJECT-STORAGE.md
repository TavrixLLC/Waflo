# Object storage

Local W2 uses `tmp/waflo-assets` and `tmp/waflo-previews`, while database records retain provider-neutral object keys. The production seam is `storageRoot`/object-key handling in the asset and preview services; a private bucket adapter and signed reads are required before production exposure.
