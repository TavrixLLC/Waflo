import { mkdir, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  LegacyApplePassGenerator,
  TestApplePassSigner,
} from "../packages/wallet-apple/src/index.ts";

const outputDirectory = "artifacts/legacy-apple-ios26-proof";
const membership = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Cedar Coffee",
  programId: "00000000-0000-4000-8000-000000000002",
  programVersionId: "00000000-0000-4000-8000-000000000003",
  programName: "Cedar Circle",
  description: "A bilingual coffee loyalty membership.",
  rewardSummary: "A complimentary drink after eight stamps.",
  backgroundColor: "#F7F4EE",
  foregroundColor: "#241916",
  walletPassInstanceId: "00000000-0000-4000-8000-000000000004",
  providerIdentity: "waflo.00000000000040008000000000000004",
  publicMembershipId: "member_m8PNYl1aSr9bT0V4w89d3H2g",
  displayName: "Amina",
  credentialPayload: "wfl1.opaque.proof.credential",
  currentStampCount: 5,
  requiredStampCount: 8,
  rewardReady: false,
  membershipStatus: "ACTIVE",
  programStatus: "PUBLISHED",
  transferred: false,
  locale: "en",
  stampRenderInput: {
    organizationId: "00000000-0000-4000-8000-000000000001",
    programId: "00000000-0000-4000-8000-000000000002",
    programVersionId: "00000000-0000-4000-8000-000000000003",
    membershipId: "00000000-0000-4000-8000-000000000005",
    rendererSchemaVersion: "waflo-stamp-render-v1",
    locale: "en",
    requiredStampCount: 8,
    currentStampCount: 5,
    rewardReady: false,
    layoutType: "GRID",
    layoutConfiguration: { columns: 4 },
    visualTheme: {
      filledColor: "#E4572E",
      emptyColor: "#F3A712",
      accentColor: "#E4572E",
      backgroundColor: "#F7F4EE",
      foregroundColor: "#241916",
      stampSize: 48,
      spacing: 8,
    },
    filledArtwork: {
      kind: "svg",
      trusted: true,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#E4572E"/></svg>',
    },
    emptyArtwork: {
      kind: "svg",
      trusted: true,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#F7F4EE" stroke="#241916" stroke-width="7"/></svg>',
    },
    assetDigests: { filled: "b".repeat(64), empty: "c".repeat(64) },
    outputProfile: "APPLE_WALLET",
  },
};
const configuration = {
  passTypeIdentifier: "pass.app.waflo",
  teamIdentifier: "WAFLOTEAM",
  organizationName: "Waflo",
  webServiceUrl: "https://api.waflo.app/v1/apple-wallet",
};

const generator = new LegacyApplePassGenerator(new TestApplePassSigner());
const artifact = await generator.generatePass({
  membership,
  configuration,
  authenticationToken: "a".repeat(43),
});
const entries = unzipSync(artifact);
const passJson = JSON.parse(Buffer.from(entries["pass.json"]).toString("utf8"));
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/legacy-ios26.pkpass`, artifact);
await writeFile(`${outputDirectory}/pass.json`, JSON.stringify(passJson, null, 2));

const field = (name) =>
  [
    ...(passJson.storeCard.headerFields ?? []),
    ...(passJson.storeCard.primaryFields ?? []),
    ...(passJson.storeCard.secondaryFields ?? []),
    ...(passJson.storeCard.auxiliaryFields ?? []),
  ].find((candidate) => candidate.key === name);
const escaped = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620"><rect width="900" height="620" fill="#e9edf2"/><rect x="170" y="28" width="560" height="564" rx="30" fill="#F7F4EE" stroke="#c5ccd5" stroke-width="2"/><rect x="202" y="60" width="38" height="38" rx="8" fill="#E4572E"/><path d="M210 71l6 18 5-10 5 10 6-18" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="252" y="85" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#241916">${escaped(passJson.logoText)}</text><text x="666" y="74" text-anchor="end" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#766b65">${escaped(field("progress")?.label ?? "STAMPS")}</text><text x="666" y="96" text-anchor="end" font-family="Arial,sans-serif" font-size="20" font-weight="800" fill="#241916">${escaped(field("progress")?.value ?? "")}</text><line x1="202" y1="128" x2="698" y2="128" stroke="#ddd4cb"/><text x="202" y="168" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#766b65">${escaped(field("reward")?.label ?? "REWARD")}</text><text x="202" y="198" font-family="Arial,sans-serif" font-size="24" font-weight="800" fill="#241916">${escaped(field("reward")?.value ?? "")}</text><text x="202" y="246" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#766b65">${escaped(field("program")?.label ?? "PROGRAM")}</text><text x="202" y="274" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#241916">${escaped(field("program")?.value ?? "")}</text><rect x="202" y="320" width="226" height="102" rx="16" fill="#fff" stroke="#e4ded8"/><text x="222" y="350" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#766b65">${escaped(field("member")?.label ?? "MEMBER")}</text><text x="222" y="382" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#241916">${escaped(field("member")?.value ?? "")}</text><rect x="442" y="320" width="256" height="102" rx="16" fill="#fff" stroke="#e4ded8"/><text x="462" y="350" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#766b65">${escaped(field("status")?.label ?? "STATUS")}</text><text x="462" y="382" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#241916">${escaped(field("status")?.value ?? "")}</text><rect x="202" y="468" width="496" height="70" rx="14" fill="#241916"/><text x="450" y="512" text-anchor="middle" font-family="monospace" font-size="16" fill="#fff">LEGACY APPLE QR • ${escaped(passJson.barcodes[0].format)}</text><text x="450" y="574" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#766b65">Diagnostic layout derived from generated pass.json; not an Apple Wallet native render.</text></svg>`;
await writeFile(`${outputDirectory}/legacy-ios26-diagnostic.svg`, svg);
await sharp(Buffer.from(svg)).png().toFile(`${outputDirectory}/legacy-ios26-diagnostic.png`);
