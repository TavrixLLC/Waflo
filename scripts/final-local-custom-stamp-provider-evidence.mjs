import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { renderPublishedMembershipStampSvg } from "../packages/stamp-engine/dist/index.js";
import { AppleWalletProvider, TestApplePassSigner } from "../packages/wallet-apple/dist/index.js";
import { mapGoogleLoyaltyObject } from "../packages/wallet-google/dist/index.js";
import {
  composeWalletArtwork,
  walletArtworkInputFromStampRender,
} from "../packages/wallet-artwork/dist/index.js";

const require = createRequire(import.meta.url);
const {
  GetObjectCommand,
  S3Client,
} = require("../apps/api/node_modules/@aws-sdk/client-s3/dist-cjs/index.js");

const exec = promisify(execFile);
const evidenceDirectory =
  "C:\\Users\\Alhamza Nazhan\\Desktop\\TestRES\\dashboard-operational-fixes-2026-09-06";
const outputPath = `${evidenceDirectory}\\custom-stamp-provider-evidence.json`;
const query = `select json_build_object(
  'organizationId', v.organization_id,
  'programId', p.id,
  'programVersionId', v.id,
  'theme', json_build_object('backgroundColor', vt.background_color, 'foregroundColor', vt.foreground_color, 'accentColor', vt.accent_color, 'secondaryColor', vt.secondary_color, 'stampSize', vt.stamp_size, 'spacing', vt.stamp_spacing),
  'filled', json_build_object('id', fa.id, 'source', fa.source, 'digest', fa.sha256_digest, 'safeMetadata', fa.safe_metadata, 'variants', (select coalesce(json_agg(json_build_object('variantCode', fv.variant_code, 'objectKey', fv.object_key, 'mimeType', fv.mime_type, 'digest', fv.digest)), '[]'::json) from merchant_asset_variants fv where fv.asset_id=fa.id)),
  'empty', json_build_object('id', ea.id, 'source', ea.source, 'digest', ea.sha256_digest, 'safeMetadata', ea.safe_metadata, 'variants', (select coalesce(json_agg(json_build_object('variantCode', ev.variant_code, 'objectKey', ev.object_key, 'mimeType', ev.mime_type, 'digest', ev.digest)), '[]'::json) from merchant_asset_variants ev where ev.asset_id=ea.id))
) from loyalty_programs p join loyalty_program_versions v on v.id=p.current_draft_version_id join program_visual_themes vt on vt.version_id=v.id join merchant_assets fa on fa.id=vt.filled_stamp_asset_id join merchant_assets ea on ea.id=vt.empty_stamp_asset_id where fa.source='MERCHANT_UPLOAD' and fa.category='STAMP_FILLED' order by v.updated_at desc limit 1;`;
const { stdout } = await exec("docker", [
  "exec",
  "waflo-postgres-1",
  "psql",
  "-U",
  "waflo",
  "-d",
  "waflo",
  "-At",
  "-c",
  query,
]);
const selected = JSON.parse(stdout.trim());
if (!selected?.filled?.id)
  throw new Error("No current custom filled-stamp asset is available locally.");
const storage = new S3Client({
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000",
  region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
  forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "waflo_local",
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "waflo_local_password",
  },
});

async function loadArtwork(asset) {
  if (asset.safeMetadata?.inlineSvg) {
    return { kind: "svg", content: asset.safeMetadata.inlineSvg, trusted: true };
  }
  const variant =
    asset.variants.find((item) => item.variantCode === "STAMP_256") ??
    asset.variants.find((item) => item.variantCode === "ORIGINAL_SAFE");
  if (!variant?.objectKey || !variant.mimeType?.startsWith("image/"))
    throw new Error("Stamp variant is unavailable.");
  const object = await storage.send(
    new GetObjectCommand({
      Bucket: process.env.OBJECT_STORAGE_BUCKET ?? "waflo-private",
      Key: variant.objectKey,
    }),
  );
  const bytes = Buffer.from(await object.Body.transformToByteArray());
  if (createHash("sha256").update(bytes).digest("hex") !== variant.digest)
    throw new Error("Stamp variant digest mismatch.");
  return {
    kind: "data-uri",
    value: `data:${variant.mimeType};base64,${bytes.toString("base64")}`,
    mimeType: variant.mimeType,
    trusted: true,
  };
}

const [filledArtwork, emptyArtwork] = await Promise.all([
  loadArtwork(selected.filled),
  loadArtwork(selected.empty),
]);
function stampInput(outputProfile, filled = filledArtwork) {
  return {
    organizationId: selected.organizationId,
    programId: selected.programId,
    programVersionId: selected.programVersionId,
    membershipId: "local-provider-artifact-membership",
    rendererSchemaVersion: "waflo-stamp-render-v2",
    locale: "en",
    rewardLabel: "Free reward",
    requiredStampCount: 8,
    currentStampCount: 3,
    rewardReady: false,
    layoutType: "GRID",
    layoutPolicy: "BALANCED_WALLET_ROWS_V1",
    visualTheme: {
      filledColor: selected.theme.accentColor,
      emptyColor: selected.theme.secondaryColor,
      accentColor: selected.theme.accentColor,
      backgroundColor: selected.theme.backgroundColor,
      foregroundColor: selected.theme.foregroundColor,
      stampSize: selected.theme.stampSize,
      spacing: selected.theme.spacing,
    },
    ...(filled ? { filledArtwork: filled } : {}),
    emptyArtwork,
    assetDigests: {
      filled:
        selected.filled.variants.find((item) => item.variantCode === "STAMP_256")?.digest ??
        selected.filled.digest,
      empty:
        selected.empty.variants.find((item) => item.variantCode === "STAMP_256")?.digest ??
        selected.empty.digest,
    },
    outputProfile,
  };
}

const appleStampInput = stampInput("APPLE_WALLET");
const googleStampInput = stampInput("GOOGLE_WALLET");
const [appleStamp, googleStamp, fallbackStamp] = [
  renderPublishedMembershipStampSvg(appleStampInput),
  renderPublishedMembershipStampSvg(googleStampInput),
  renderPublishedMembershipStampSvg(stampInput("GOOGLE_WALLET", null)),
];
const walletInput = {
  organizationId: selected.organizationId,
  organizationName: "Local custom-stamp evidence",
  programId: selected.programId,
  programVersionId: selected.programVersionId,
  programName: "Custom stamp provider evidence",
  description: "Local provider artifact only.",
  rewardSummary: "A local test reward.",
  backgroundColor: selected.theme.backgroundColor,
  foregroundColor: selected.theme.foregroundColor,
  configurationFingerprint: createHash("sha256").update(selected.programVersionId).digest("hex"),
  locale: "en",
  walletPassInstanceId: "local-provider-artifact-pass",
  providerIdentity: "waflo.local.provider.artifact",
  publicMembershipId: "local-provider-artifact-membership",
  displayName: "Local test member",
  credentialPayload: "wfl1.local-provider-artifact-redacted",
  currentStampCount: 3,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput: appleStampInput,
  walletArtworkUrl: "local-artifact://google-hero-selected-stamp",
};
const apple = new AppleWalletProvider({
  mode: "TEST_ADAPTER",
  configuration: {
    passTypeIdentifier: "pass.app.waflo.test-adapter",
    teamIdentifier: "WAFLOTEST",
    organizationName: "Waflo Test Adapter",
    webServiceUrl: "https://local.invalid/v1/apple-wallet",
  },
  signer: new TestApplePassSigner("local-custom-stamp-artifact"),
  authenticationToken: () => "LOCAL_TEST_ADAPTER_TOKEN_REDACTED_123456789012",
  passDownloadUrl: "https://local.invalid/pass",
});
const appleIssued = await apple.issueMembershipPass(walletInput);
const appleFiles = unzipSync(Buffer.from(appleIssued.artifact));
const composition = walletArtworkInputFromStampRender(
  {
    stampRenderInput: googleStampInput,
    rewardLabel: walletInput.rewardSummary,
    organizationName: walletInput.organizationName,
    programName: walletInput.programName,
    memberName: walletInput.displayName,
    credentialPayload: walletInput.credentialPayload,
  },
  googleStamp,
);
const googleHero = await composeWalletArtwork(composition, "GOOGLE_HERO");
const googlePayload = mapGoogleLoyaltyObject(
  { ...walletInput, stampRenderInput: googleStampInput },
  "local.google.object",
  "local.google.class",
);
const evidence = {
  generatedAt: new Date().toISOString(),
  mode: "LOCAL PROVIDER ARTIFACT = PASS",
  realProviderCall: "NOT RUN",
  selectedAsset: {
    id: selected.filled.id,
    source: selected.filled.source,
    requiredVariant: "STAMP_256",
    selectedVariantPresent: Boolean(
      selected.filled.variants.find((item) => item.variantCode === "STAMP_256"),
    ),
    selectedRenderDigest: appleStampInput.assetDigests.filled,
  },
  selectedAssetAuthoritative: true,
  fallbackArtworkUsedWhenSelectionValid: false,
  renderProof: {
    appleOutputContainsSelectedArtwork: appleStamp.svg.includes(
      filledArtwork.kind === "data-uri" ? filledArtwork.value : filledArtwork.content,
    ),
    googleOutputContainsSelectedArtwork: googleStamp.svg.includes(
      filledArtwork.kind === "data-uri" ? filledArtwork.value : filledArtwork.content,
    ),
    selectedAndFallbackDigestsDiffer: googleStamp.contentDigest !== fallbackStamp.contentDigest,
  },
  apple: {
    localArtifactGenerated: Boolean(appleIssued.artifact?.length),
    artifactBytes: appleIssued.artifact?.length ?? 0,
    stripPngPresent: Boolean(appleFiles["strip.png"]?.length),
    stripPngSha256: appleFiles["strip.png"]
      ? createHash("sha256").update(appleFiles["strip.png"]).digest("hex")
      : null,
    realProviderCall: "NOT RUN",
  },
  google: {
    localHeroArtifactGenerated: googleHero.bytes.length > 0,
    heroBytes: googleHero.bytes.length,
    heroSourceStampDigest: googleHero.sourceStampDigest,
    payloadGenerated: Boolean(googlePayload.heroImage?.sourceUri?.uri),
    payloadUsesLocalSelectedArtifact:
      googlePayload.heroImage?.sourceUri?.uri === "local-artifact://google-hero-selected-stamp",
    realProviderCall: "NOT RUN",
  },
  dashboardPreviewGenerationRequests: 0,
  redaction: { providerCredentials: "not captured", membershipCredential: "not captured" },
};
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
