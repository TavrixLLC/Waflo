import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  loadHistoricalWalletStampSource,
  type PersistedWalletStampAsset,
} from "../../apps/wallet-worker/src/historical-wallet-stamp-source.js";
import { productionV1WalletAssetRecoveries } from "../../apps/wallet-worker/src/production-v1-wallet-assets.js";

const filledSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="historical-filled" d="M5 5h90v90H5z"/></svg>';
const overrideSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="merchant-override" d="M50 2 98 98H2Z"/></svg>';

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function asset(
  input: Partial<PersistedWalletStampAsset> & Pick<PersistedWalletStampAsset, "id">,
): PersistedWalletStampAsset {
  return {
    id: input.id,
    category: input.category ?? "STAMP_FILLED",
    source: input.source ?? "WAFLO_LIBRARY",
    sha256Digest: input.sha256Digest ?? "a".repeat(64),
    safeMetadata: input.safeMetadata ?? null,
    variants: input.variants ?? [],
  };
}

describe("historical Wallet stamp source", () => {
  it("returns the exact persisted inline filled asset without reconstruction", async () => {
    const getObject = vi.fn(async () => {
      throw new Error("object storage must not be used for inline historical artwork");
    });
    const loaded = await loadHistoricalWalletStampSource(
      asset({
        id: "11111111-1111-4111-8111-111111111111",
        safeMetadata: { inlineSvg: filledSvg },
        variants: [
          {
            variantCode: "STAMP_256",
            objectKey: "historical/filled.png",
            mimeType: "image/png",
            digest: "b".repeat(64),
          },
        ],
      }),
      getObject,
    );
    expect(loaded.artwork).toEqual({ kind: "svg", content: filledSvg, trusted: true });
    expect(loaded.identity).toMatchObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      resolution: "INLINE_SVG",
      selectedVariantCode: "STAMP_256",
      renderDigest: "b".repeat(64),
      contentDigest: digest(filledSvg),
    });
    expect(getObject).not.toHaveBeenCalled();
  });

  it("loads the exact stored empty STAMP_256 bytes before ORIGINAL_SAFE", async () => {
    const bytes = Buffer.from("exact-historical-empty-png-bytes", "utf8");
    const getObject = vi.fn(async (objectKey: string) => {
      expect(objectKey).toBe("historical/empty-stamp-256.png");
      return bytes;
    });
    const loaded = await loadHistoricalWalletStampSource(
      asset({
        id: "22222222-2222-4222-8222-222222222222",
        category: "STAMP_EMPTY",
        source: "UPLOAD",
        variants: [
          {
            variantCode: "ORIGINAL_SAFE",
            objectKey: "historical/empty-original.png",
            mimeType: "image/png",
            digest: "c".repeat(64),
          },
          {
            variantCode: "STAMP_256",
            objectKey: "historical/empty-stamp-256.png",
            mimeType: "image/png",
            digest: digest(bytes),
          },
        ],
      }),
      getObject,
    );
    expect(loaded.artwork).toEqual({
      kind: "data-uri",
      value: `data:image/png;base64,${bytes.toString("base64")}`,
      mimeType: "image/png",
      trusted: true,
    });
    expect(loaded.identity).toMatchObject({
      assetId: "22222222-2222-4222-8222-222222222222",
      source: "UPLOAD",
      selectedVariantCode: "STAMP_256",
      contentDigest: digest(bytes),
    });
  });

  it("preserves the published merchant override instead of selecting a library default", async () => {
    const library = asset({
      id: "33333333-3333-4333-8333-333333333333",
      safeMetadata: { inlineSvg: filledSvg },
    });
    const publishedMerchantOverride = asset({
      id: "44444444-4444-4444-8444-444444444444",
      source: "UPLOAD",
      safeMetadata: { inlineSvg: overrideSvg },
    });
    const loaded = await loadHistoricalWalletStampSource(publishedMerchantOverride, async () =>
      Buffer.alloc(0),
    );
    expect(loaded.identity.assetId).toBe(publishedMerchantOverride.id);
    expect(loaded.identity.assetId).not.toBe(library.id);
    expect(loaded.artwork).toMatchObject({ content: overrideSvg });
    expect(JSON.stringify(loaded.artwork)).toContain("merchant-override");
    expect(JSON.stringify(loaded.artwork)).not.toContain("historical-filled");
  });

  it("fails closed when stored historical bytes do not match the persisted digest", async () => {
    await expect(
      loadHistoricalWalletStampSource(
        asset({
          id: "55555555-5555-4555-8555-555555555555",
          safeMetadata: null,
          variants: [
            {
              variantCode: "STAMP_256",
              objectKey: "historical/corrupt.png",
              mimeType: "image/png",
              digest: "d".repeat(64),
            },
          ],
        }),
        async () => Buffer.from("corrupt"),
      ),
    ).rejects.toThrow("failed digest verification");
  });

  it("contains no template catalog or icon fallback", () => {
    const source = readFileSync("apps/wallet-worker/src/historical-wallet-stamp-source.ts", "utf8");
    expect(source).not.toMatch(/programTemplateCatalog|artworkFor|resolveProductionTemplate/i);
    expect(source).not.toMatch(/fallbackArtwork|category.*default/i);
  });

  it("resolves all 12 recovered production-v1 assets by their exact historical IDs", async () => {
    const historicalAssets = productionV1WalletAssetRecoveries.flatMap((entry) => [
      entry.filled,
      entry.empty,
    ]);
    expect(productionV1WalletAssetRecoveries).toHaveLength(6);
    expect(new Set(historicalAssets.map((item) => item.id)).size).toBe(12);
    for (const historical of historicalAssets) {
      const loaded = await loadHistoricalWalletStampSource(
        asset({
          id: historical.id,
          category: historical.category,
          source: historical.source,
          sha256Digest: historical.sha256Digest,
          safeMetadata: { [historical.metadataFlag]: true },
        }),
        async () => {
          throw new Error("recovered inline historical artwork must not use object storage");
        },
      );
      expect(loaded.artwork).toEqual({
        kind: "svg",
        content: historical.inlineSvg,
        trusted: true,
      });
      expect(loaded.identity).toMatchObject({
        assetId: historical.id,
        resolution: "INLINE_SVG",
        contentDigest: digest(historical.inlineSvg),
      });
      expect(loaded.identity.recoverySourceReference).toContain(
        "4e77af6aabb184b01e54647b1562a326159bf5a4",
      );
    }
  });

  it("fails closed if a recovered asset ID no longer matches its historical provenance", async () => {
    const firstRecovery = productionV1WalletAssetRecoveries[0];
    if (!firstRecovery) throw new Error("production-v1 recovery manifest is empty");
    const historical = firstRecovery.filled;
    await expect(
      loadHistoricalWalletStampSource(
        asset({
          id: historical.id,
          category: historical.category,
          source: historical.source,
          sha256Digest: "f".repeat(64),
          safeMetadata: { evidenceFixture: true },
        }),
        async () => Buffer.alloc(0),
      ),
    ).rejects.toThrow("no longer matches production-v1 provenance");
  });
});
