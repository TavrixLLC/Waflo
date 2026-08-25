import { createHash } from "node:crypto";

export const PRODUCTION_V1_WALLET_COMMIT = "4e77af6aabb184b01e54647b1562a326159bf5a4";
export const PRODUCTION_V1_ASSET_DEFINITION_COMMIT = "c2e3d788";

const browserFilled =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#AE3115" d="M27 8c25-12 55 8 52 36-2 24-20 44-46 48-17-17-21-38-16-55C20 25 23 16 27 8Z"/><path fill="none" stroke="#F7F4EE" stroke-width="7" stroke-linecap="round" d="M65 19C47 37 38 56 34 78"/></svg>';
const browserEmpty =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M27 8c25-12 55 8 52 36-2 24-20 44-46 48-17-17-21-38-16-55C20 25 23 16 27 8Z"/><path fill="none" stroke="#241916" stroke-width="7" stroke-linecap="round" d="M65 19C47 37 38 56 34 78"/></svg>';
const cedarFilled =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#AE3115" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>';
const cedarEmpty =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>';

export interface ProductionV1HistoricalAsset {
  readonly id: string;
  readonly role: "FILLED" | "EMPTY";
  readonly category: "STAMP_FILLED" | "STAMP_EMPTY";
  readonly source: "WAFLO_LIBRARY";
  readonly originalObjectKey: string;
  readonly originalFilename: "filled.svg" | "empty.svg";
  readonly mimeType: "image/svg+xml";
  readonly fileSize: number;
  readonly width: 256;
  readonly height: 256;
  readonly sha256Digest: string;
  readonly metadataFlag: "evidenceFixture" | "testFixture";
  readonly inlineSvg: string;
}

export interface ProductionV1WalletVersionRecovery {
  readonly alias: string;
  readonly versionId: string;
  readonly themeId: string;
  readonly programName: string;
  readonly sourcePath: string;
  readonly sourceLines: string;
  readonly sourceBlob: string;
  readonly filled: ProductionV1HistoricalAsset;
  readonly empty: ProductionV1HistoricalAsset;
}

function browserAsset(
  runId: string,
  id: string,
  role: "FILLED" | "EMPTY",
): ProductionV1HistoricalAsset {
  const filled = role === "FILLED";
  return {
    id,
    role,
    category: filled ? "STAMP_FILLED" : "STAMP_EMPTY",
    source: "WAFLO_LIBRARY",
    originalObjectKey: `evidence/${runId}/${filled ? "filled" : "empty"}.svg`,
    originalFilename: filled ? "filled.svg" : "empty.svg",
    mimeType: "image/svg+xml",
    fileSize: 64,
    width: 256,
    height: 256,
    sha256Digest: runId.padEnd(64, filled ? "1" : "2").slice(0, 64),
    metadataFlag: "evidenceFixture",
    inlineSvg: filled ? browserFilled : browserEmpty,
  };
}

export const productionV1WalletAssetRecoveries: readonly ProductionV1WalletVersionRecovery[] = [
  {
    alias: "published-2aed15e88599",
    versionId: "c697412c-1a37-4b9d-84c4-4383987f9ca8",
    themeId: "0f225135-5a95-4265-af9c-c3ba315fd735",
    programName: "W3 Browser Circle 2a181eea",
    sourcePath: "tests/e2e/w3-platform.spec.ts",
    sourceLines: "122-159",
    sourceBlob: "b71b4ddcc1a74e962abfaa345ce44d8adea858b3",
    filled: browserAsset("2a181eea", "950792b2-3bd8-42fc-9dfa-9ff1ae5d8119", "FILLED"),
    empty: browserAsset("2a181eea", "f7e3861f-8b0e-4876-b20a-906a6d7976fb", "EMPTY"),
  },
  {
    alias: "published-b5eec8123013",
    versionId: "5e403e8b-b092-4742-9f60-514c18141af9",
    themeId: "37128425-1e3d-4958-ae91-39276509bd8b",
    programName: "W3 Browser Circle 7292da93",
    sourcePath: "tests/e2e/w3-platform.spec.ts",
    sourceLines: "122-159",
    sourceBlob: "b71b4ddcc1a74e962abfaa345ce44d8adea858b3",
    filled: browserAsset("7292da93", "f19fbd5f-4cd6-4feb-970f-97d812df3563", "FILLED"),
    empty: browserAsset("7292da93", "33af9314-5784-477d-940f-757f78023b34", "EMPTY"),
  },
  {
    alias: "published-47c59751c2ed",
    versionId: "7634ee7f-ce52-41f7-a0a9-9104fec2bd18",
    themeId: "2d674a78-ee8b-4bf8-a3c7-ed2db40d3122",
    programName: "W3 Browser Circle 167fdeed",
    sourcePath: "tests/e2e/w3-platform.spec.ts",
    sourceLines: "122-159",
    sourceBlob: "b71b4ddcc1a74e962abfaa345ce44d8adea858b3",
    filled: browserAsset("167fdeed", "83608bcf-9552-4175-ae3d-1adf188b637c", "FILLED"),
    empty: browserAsset("167fdeed", "8130cb3a-bd44-45c2-96b1-18ac55d725bb", "EMPTY"),
  },
  {
    alias: "published-1989927b29be",
    versionId: "6247aaca-abf5-4f0b-808d-e8532901f12c",
    themeId: "f6bbc76a-39d9-41b8-99d5-b017ee871b1e",
    programName: "W3 Browser Circle c9e7e530",
    sourcePath: "tests/e2e/w3-platform.spec.ts",
    sourceLines: "122-159",
    sourceBlob: "b71b4ddcc1a74e962abfaa345ce44d8adea858b3",
    filled: browserAsset("c9e7e530", "3feda71e-141c-4275-b00a-d2eb0cfe70d2", "FILLED"),
    empty: browserAsset("c9e7e530", "a5f5f1d5-bcfe-4b7f-97a8-903ff4f25840", "EMPTY"),
  },
  {
    alias: "published-3eea785adc10",
    versionId: "ac96bacd-00f6-454a-b017-ca65ad550281",
    themeId: "db5d6518-65df-4353-8eac-4938c50e686b",
    programName: "W3 Browser Circle 9fe43b84",
    sourcePath: "tests/e2e/w3-platform.spec.ts",
    sourceLines: "122-159",
    sourceBlob: "b71b4ddcc1a74e962abfaa345ce44d8adea858b3",
    filled: browserAsset("9fe43b84", "f7cfed98-4807-44c7-877b-28e56552037d", "FILLED"),
    empty: browserAsset("9fe43b84", "0445f996-0680-4c06-85ad-19f4c335ed17", "EMPTY"),
  },
  {
    alias: "published-02e98908f894",
    versionId: "c7e44690-05a9-4eed-a63f-f974448b1552",
    themeId: "e151dc73-0e56-4576-a4a8-cb3e2974cd07",
    programName: "Cedar Circle",
    sourcePath: "tests/http/w3-customer-boundary.test.ts",
    sourceLines: "120-157",
    sourceBlob: "7bf3aeffab4834d6dc660240c3da0d486a9efaf2",
    filled: {
      id: "36b7ca07-9e63-480b-8d60-0c87d6a2df87",
      role: "FILLED",
      category: "STAMP_FILLED",
      source: "WAFLO_LIBRARY",
      originalObjectKey: "test/988116be/filled.svg",
      originalFilename: "filled.svg",
      mimeType: "image/svg+xml",
      fileSize: 32,
      width: 256,
      height: 256,
      sha256Digest: "1".repeat(64),
      metadataFlag: "testFixture",
      inlineSvg: cedarFilled,
    },
    empty: {
      id: "cc30963d-6b43-47dd-a4a0-6ed528dbf3c1",
      role: "EMPTY",
      category: "STAMP_EMPTY",
      source: "WAFLO_LIBRARY",
      originalObjectKey: "test/988116be/empty.svg",
      originalFilename: "empty.svg",
      mimeType: "image/svg+xml",
      fileSize: 32,
      width: 256,
      height: 256,
      sha256Digest: "2".repeat(64),
      metadataFlag: "testFixture",
      inlineSvg: cedarEmpty,
    },
  },
] as const;

export interface ProductionV1RecoveredStampLookup {
  readonly id: string;
  readonly category: string;
  readonly source: string;
  readonly sha256Digest: string;
  readonly safeMetadata: unknown;
}

export interface ProductionV1RecoveredStamp {
  readonly inlineSvg: string;
  readonly contentDigest: string;
  readonly sourceReference: string;
}

const recoveredAssets = new Map(
  productionV1WalletAssetRecoveries.flatMap((entry) =>
    [entry.filled, entry.empty].map(
      (asset) =>
        [
          asset.id,
          {
            asset,
            sourceReference: `${PRODUCTION_V1_WALLET_COMMIT}:${entry.sourcePath}:${entry.sourceLines}`,
          },
        ] as const,
    ),
  ),
);

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function lookupProductionV1RecoveredStamp(
  current: ProductionV1RecoveredStampLookup,
): ProductionV1RecoveredStamp | null {
  const recovery = recoveredAssets.get(current.id);
  if (!recovery) return null;
  const { asset } = recovery;
  const metadata = metadataRecord(current.safeMetadata);
  if (
    current.category !== asset.category ||
    current.source !== asset.source ||
    current.sha256Digest !== asset.sha256Digest ||
    metadata[asset.metadataFlag] !== true
  ) {
    throw new Error(
      `Historical Wallet asset ${current.id} no longer matches production-v1 provenance.`,
    );
  }
  const persistedSvg = metadata.inlineSvg;
  if (typeof persistedSvg === "string" && persistedSvg !== asset.inlineSvg) {
    throw new Error(`Historical Wallet asset ${current.id} contains unexpected inline SVG bytes.`);
  }
  return {
    inlineSvg: asset.inlineSvg,
    contentDigest: createHash("sha256").update(asset.inlineSvg).digest("hex"),
    sourceReference: recovery.sourceReference,
  };
}
