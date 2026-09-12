import { writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  buildApplePassPackage,
  mapAppleStoreCard,
  TestApplePassSigner,
} from "../packages/wallet-apple/dist/index.js";

const outputDirectory =
  "C:/Users/Alhamza Nazhan/Desktop/TestRES/billing-branding-local-fixes-2026-09-06";
const configuration = {
  passTypeIdentifier: "pass.app.waflo",
  teamIdentifier: "WAFLOTEAM",
  organizationName: "Waflo",
  webServiceUrl: "https://api.example.invalid/v1/apple-wallet",
};
const membership = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Cedar Coffee",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  programName: "Cedar Circle",
  description: "A local thumbnail evidence pass.",
  rewardSummary: "A complimentary drink after eight stamps.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  configurationFingerprint: "local-thumbnail-evidence",
  locale: "en",
  walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
  providerIdentity: "waflo.00000000000040008000000000000004",
  publicMembershipId: "member_local_thumbnail",
  displayName: "Amina",
  credentialPayload: "wfl1.local-thumbnail-evidence",
  currentStampCount: 5,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  stampRenderInput: {
    assetDigests: { filled: "filled-digest", empty: "empty-digest" },
    currentStampCount: 5,
  },
};

const pass = mapAppleStoreCard(membership, configuration, "a".repeat(43));
const packageBytes = await buildApplePassPackage({ pass, signer: new TestApplePassSigner() });
const files = unzipSync(packageBytes);
const names = ["thumbnail.png", "thumbnail@2x.png", "thumbnail@3x.png"];
const metadata = {};
for (const name of names) {
  const bytes = files[name];
  if (!bytes) throw new Error(`Missing ${name} in local Apple pass evidence package.`);
  await writeFile(`${outputDirectory}/${name}`, bytes);
  metadata[name] = await sharp(bytes).metadata();
}
await writeFile(
  `${outputDirectory}/apple-thumbnail-package-evidence.json`,
  `${JSON.stringify({ packageFiles: Object.keys(files).filter((name) => name.startsWith("thumbnail")), metadata }, null, 2)}\n`,
  "utf8",
);
