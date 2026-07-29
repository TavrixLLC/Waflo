import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import sharp from "../apps/api/node_modules/sharp/dist/index.mjs";
import { AppleWalletProvider, TestApplePassSigner } from "../packages/wallet-apple/dist/index.js";
import {
  googleLoyaltyClassId,
  googleLoyaltyObjectId,
  mapGoogleLoyaltyClass,
  mapGoogleLoyaltyObject,
} from "../packages/wallet-google/dist/index.js";

const directory = resolve("artifacts/handoff-w3-round-1/provider-artifacts");
await mkdir(directory, { recursive: true });

const beanFilled =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#AE3115" d="M27 8c25-12 55 8 52 36-2 24-20 44-46 48-17-17-21-38-16-55C20 25 23 16 27 8Z"/><path fill="none" stroke="#F7F4EE" stroke-width="7" stroke-linecap="round" d="M65 19C47 37 38 56 34 78"/></svg>';
const beanEmpty =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M27 8c25-12 55 8 52 36-2 24-20 44-46 48-17-17-21-38-16-55C20 25 23 16 27 8Z"/><path fill="none" stroke="#241916" stroke-width="7" stroke-linecap="round" d="M65 19C47 37 38 56 34 78"/></svg>';

const stampRenderInput = {
  organizationId: "test-org",
  programId: "test-program",
  programVersionId: "test-program-version-v1",
  membershipId: "test-membership",
  rendererSchemaVersion: "waflo-stamp-render-v1",
  locale: "en",
  requiredStampCount: 8,
  currentStampCount: 3,
  rewardReady: false,
  layoutType: "GRID",
  layoutConfiguration: { columns: 4 },
  visualTheme: {
    filledColor: "#AE3115",
    emptyColor: "#F3A712",
    accentColor: "#AE3115",
    backgroundColor: "#F7F4EE",
    foregroundColor: "#241916",
    stampSize: 48,
    spacing: 8,
  },
  filledArtwork: { kind: "svg", content: beanFilled, trusted: true },
  emptyArtwork: { kind: "svg", content: beanEmpty, trusted: true },
  assetDigests: { filled: "1".repeat(64), empty: "2".repeat(64) },
  outputProfile: "APPLE_WALLET",
};

const walletInput = {
  organizationId: "test-org",
  organizationName: "Today Coffee",
  programId: "test-program",
  programVersionId: "test-program-version-v1",
  programName: "Today Coffee Rewards",
  description: "Synthetic Waflo Test Adapter package evidence.",
  rewardSummary: "A complimentary signature drink.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  configurationFingerprint: "a".repeat(64),
  locale: "en",
  walletPassInstanceId: "test-wallet-pass",
  providerIdentity: "waflo.test.adapter.serial",
  publicMembershipId: "synthetic_test_membership",
  displayName: "Test Member",
  credentialPayload: "wfl1.synthetic.test-adapter-only",
  currentStampCount: 3,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput,
  programLogoUrl: "https://assets.example.test/waflo/program-logo",
  publicAssetBaseUrl: "https://assets.example.test/wpa_opaque_progress",
};

const apple = new AppleWalletProvider({
  mode: "TEST_ADAPTER",
  configuration: {
    passTypeIdentifier: "pass.app.waflo.test-adapter",
    teamIdentifier: "WAFLOTEST",
    organizationName: "Waflo Test Adapter",
    webServiceUrl: "https://api.example.test/v1/apple-wallet",
  },
  signer: new TestApplePassSigner("synthetic-evidence-signature"),
  authenticationToken: () => "TEST_ADAPTER_ONLY_AUTH_TOKEN_123456789012",
  passDownloadUrl: "https://customer.example.test/test-pass",
});
const issued = await apple.issueMembershipPass(walletInput);
const packageBytes = Buffer.from(issued.artifact);
await writeFile(resolve(directory, "apple-test-adapter.pkpass"), packageBytes);
const files = unzipSync(packageBytes);
await writeFile(resolve(directory, "apple-strip.png"), Buffer.from(files["strip.png"] ?? []));

const manifest = JSON.parse(Buffer.from(files["manifest.json"] ?? []).toString("utf8"));
const pass = JSON.parse(Buffer.from(files["pass.json"] ?? []).toString("utf8"));
const pixelEvidence = {};
for (const name of [
  "icon.png",
  "icon@2x.png",
  "icon@3x.png",
  "logo.png",
  "logo@2x.png",
  "strip.png",
]) {
  const bytes = Buffer.from(files[name] ?? []);
  const stats = await sharp(bytes).stats();
  pixelEvidence[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    nonblank: stats.channels.some((channel) => channel.max > channel.min),
  };
}
const appleInspection = {
  evidenceMode: "TEST_ADAPTER",
  externallyCertified: false,
  packageSha256: createHash("sha256").update(packageBytes).digest("hex"),
  requiredFilesPresent: [
    "pass.json",
    "manifest.json",
    "signature",
    "icon.png",
    "icon@2x.png",
    "icon@3x.png",
    "logo.png",
    "strip.png",
    "en.lproj/pass.strings",
    "ar.lproj/pass.strings",
  ].every((name) => Boolean(files[name]?.length)),
  manifestEntryCount: Object.keys(manifest).length,
  manifestComplete: Object.keys(files)
    .filter((name) => name !== "manifest.json" && name !== "signature")
    .every((name) => Boolean(manifest[name])),
  signatureBytes: files.signature?.length ?? 0,
  barcodeFieldCount: pass.barcodes?.length ?? 0,
  barcodeValueRedacted: true,
  authenticationTokenRedacted: true,
  voided: pass.voided,
  localizedEnglish: Boolean(files["en.lproj/pass.strings"]?.length),
  localizedArabic: Boolean(files["ar.lproj/pass.strings"]?.length),
  selectedArtwork: {
    filledDigest: stampRenderInput.assetDigests.filled,
    emptyDigest: stampRenderInput.assetDigests.empty,
    filledSlots: 3,
    emptySlots: 5,
    thirdState: false,
  },
  pixelEvidence,
};
await writeFile(
  resolve(directory, "apple-package-inspection.json"),
  `${JSON.stringify(appleInspection, null, 2)}\n`,
);

const classId = googleLoyaltyClassId("synthetic-issuer", walletInput.programVersionId);
const objectId = googleLoyaltyObjectId("synthetic-issuer", walletInput.walletPassInstanceId);
const googleClass = mapGoogleLoyaltyClass(walletInput, classId);
const googleObject = mapGoogleLoyaltyObject(walletInput, objectId, classId);
await writeFile(
  resolve(directory, "google-loyalty-class.redacted.json"),
  `${JSON.stringify(
    {
      ...googleClass,
      evidenceMode: "TEST_ADAPTER_MAPPING",
      externallyCertified: false,
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  resolve(directory, "google-loyalty-object.redacted.json"),
  `${JSON.stringify(
    {
      ...googleObject,
      accountName: "[SYNTHETIC TEST MEMBER REDACTED]",
      accountId: "[SYNTHETIC MEMBERSHIP ID REDACTED]",
      barcode: {
        ...googleObject.barcode,
        value: "[SYNTHETIC OPAQUE CREDENTIAL REDACTED]",
        alternateText: "[SYNTHETIC MEMBERSHIP SUFFIX REDACTED]",
      },
      evidenceMode: "TEST_ADAPTER_MAPPING",
      externallyCertified: false,
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  resolve(directory, "configured-externally-uncertified.json"),
  `${JSON.stringify(
    {
      apple: {
        configured: true,
        localPackageBuilt: true,
        providerReachable: false,
        externallyCertified: false,
        status: "EXTERNALLY_UNCERTIFIED",
      },
      google: {
        configured: true,
        mappingValidatedLocally: true,
        providerReachable: false,
        externallyCertified: false,
        providerHealthStatus: "NOT_PROBED",
        externalCertification: "PENDING",
      },
      limitation:
        "Synthetic conformance harness only; no Apple device, APNs, Google issuer, or real account certification was performed.",
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`Created W3 provider evidence in ${directory}\n`);
