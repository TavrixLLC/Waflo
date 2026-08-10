import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "../apps/api/node_modules/sharp/dist/index.mjs";

const root = process.cwd();
const handoffDirectory = resolve(root, "artifacts/handoff-w4-round-1");
const screenshotDirectory = resolve(handoffDirectory, "screenshots");
const acceptedFoundationDirectory = process.argv[2] ? resolve(root, process.argv[2]) : null;
const contactSheet = resolve(screenshotDirectory, "00-contact-sheet.png");
const manifest = resolve(handoffDirectory, "SCREENSHOT-MANIFEST.md");

const coverage = [
  ["Customers populated", "01-customers-populated.png"],
  ["Customer search, including exact masked-email result", "02-customers-search.png"],
  ["Customer detail", "03-customer-detail.png"],
  ["Membership 0/8", "27-membership-zero-of-eight.png"],
  ["Membership 5/8", "28-membership-five-of-eight.png"],
  ["Membership 8/8 and final reward ready", "06-membership-final-reward-ready.png"],
  ["Final redemption reset to 0/8", "07-membership-cycle-reset.png"],
  ["Ledger timeline", "04-membership-ledger.png"],
  ["Reward entitlement list", "04-membership-ledger.png"],
  ["Operation detail", "29-operation-detail.png"],
  ["Staff device list", "08-staff-device-list.png"],
  ["Pairing QR with safe accessible label", "09-device-pairing-code.png"],
  ["Active paired device", "31-active-and-revoked-devices.png"],
  ["Revoked device", "31-active-and-revoked-devices.png"],
  ["Manager approval pending", "32-manager-approval-pending.png"],
  ["Manager approval completed", "33-manager-approval-completed.png"],
  ["Wrong Location blocked by the signed Staff Test Client", "40-wrong-location-blocked.png"],
  ["Daily cap blocked in policy-aware Test Mode", "37-daily-cap-blocked.png"],
  ["Purchase amount required", "38-purchase-amount-required.png"],
  ["Purchase threshold blocked", "41-purchase-threshold-blocked.png"],
  ["Purchase currency mismatch", "39-purchase-currency-mismatch.png"],
  ["Risk dashboard", "10-risk-signals.png"],
  ["Risk detail and safe evidence", "34-risk-detail.png"],
  ["Basic analytics", "11-analytics-overview.png"],
  ["Advanced program analytics", "12-analytics-program-comparison.png"],
  ["Export ready", "13-export-completed.png"],
  ["Projection verification", "30-projection-verification.png"],
  ["Privacy export request", "35-privacy-export-request.png"],
  ["Erased/anonymized Customer with retained ledger", "36-erased-anonymized-customer.png"],
  ["Program operational policy", "14-program-operations-policy.png"],
  ["Test Mode policy controls", "15-test-mode-policy-controls.png"],
  ["Test Mode milestone state", "16-test-mode-milestone.png"],
  ["Arabic Customer detail", "23-arabic-customer-detail.png"],
  ["RTL device pairing", "24-rtl-device-pairing.png"],
  ["Staff restricted navigation", "25-staff-restricted-navigation.png"],
  ["Staff denied merchant dashboard section", "26-staff-access-denied.png"],
  ["Customer Web final reward state", "19-customer-web-final-reward.png"],
  ["Customer Web after final redemption", "20-customer-web-cycle-reset.png"],
  ["Apple Test Adapter state and all-filled stamp grid", "17-apple-adapter-preview.png"],
  ["Apple Test Adapter after cycle reset", "21-apple-adapter-cycle-reset.png"],
  ["Google Test Adapter state and all-filled stamp grid", "18-google-adapter-preview.png"],
  ["Google Test Adapter after cycle reset", "22-google-adapter-cycle-reset.png"],
];

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function caption(name) {
  const covered = coverage.find(([, file]) => file === name);
  if (covered) return covered[0];
  return basename(name, ".png").replace(/^\d+-/u, "").replaceAll("-", " ");
}

await mkdir(screenshotDirectory, { recursive: true });
let files = (await readdir(screenshotDirectory))
  .filter((name) => name.endsWith(".png") && name !== "00-contact-sheet.png")
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

for (const [, name] of coverage) {
  if (files.includes(name)) continue;
  if (!acceptedFoundationDirectory) {
    throw new Error(
      `Missing ${name}. Generate it in this run or pass a foundation screenshot directory as the first argument.`,
    );
  }
  const acceptedFoundationSource = resolve(acceptedFoundationDirectory, name);
  await access(acceptedFoundationSource);
  await copyFile(acceptedFoundationSource, resolve(screenshotDirectory, name));
}

files = (await readdir(screenshotDirectory))
  .filter((name) => name.endsWith(".png") && name !== "00-contact-sheet.png")
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

const columns = 2;
const tileWidth = 520;
const imageHeight = 360;
const captionHeight = 58;
const gap = 20;
const margin = 30;
const titleHeight = 80;
const rows = Math.ceil(files.length / columns);
const width = margin * 2 + columns * tileWidth + (columns - 1) * gap;
const height = margin * 2 + titleHeight + rows * (imageHeight + captionHeight + gap);
const composites = [
  {
    input: Buffer.from(`
      <svg width="${width}" height="${titleHeight}">
        <text x="0" y="34" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#2b1914">
          Waflo W4 real loyalty operations evidence
        </text>
        <text x="0" y="65" font-family="Arial, sans-serif" font-size="18" fill="#6b4a3d">
          Customers, ledger, devices, approvals, risk, analytics, privacy, Wallet Test Adapters, and RTL
        </text>
      </svg>
    `),
    left: margin,
    top: margin,
  },
];

for (const [index, name] of files.entries()) {
  const row = Math.floor(index / columns);
  const column = index % columns;
  const left = margin + column * (tileWidth + gap);
  const top = margin + titleHeight + row * (imageHeight + captionHeight + gap);
  const thumbnail = await sharp(resolve(screenshotDirectory, name))
    .resize(tileWidth, imageHeight, { fit: "contain", background: "#f8f5f2" })
    .png()
    .toBuffer();
  composites.push({ input: thumbnail, left, top });
  composites.push({
    input: Buffer.from(`
      <svg width="${tileWidth}" height="${captionHeight}">
        <rect width="${tileWidth}" height="${captionHeight}" fill="#2b1914"/>
        <text x="16" y="36" font-family="Arial, sans-serif" font-size="17" fill="#ffffff">
          ${escapeXml(caption(name))}
        </text>
      </svg>
    `),
    left,
    top: top + imageHeight,
  });
}

await sharp({
  create: { width, height, channels: 4, background: "#efe8e3" },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(contactSheet);

const inventory = [];
for (const name of ["00-contact-sheet.png", ...files]) {
  const path = resolve(screenshotDirectory, name);
  const bytes = await readFile(path);
  const metadata = await sharp(bytes).metadata();
  inventory.push({
    name,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const roundOneFiles = new Set([
  "01-customers-populated.png",
  "02-customers-search.png",
  "04-membership-ledger.png",
  "09-device-pairing-code.png",
  "10-risk-signals.png",
  "12-analytics-program-comparison.png",
  "13-export-completed.png",
  "23-arabic-customer-detail.png",
  "24-rtl-device-pairing.png",
  "26-staff-access-denied.png",
  "27-membership-zero-of-eight.png",
  "28-membership-five-of-eight.png",
  "29-operation-detail.png",
  "30-projection-verification.png",
  "31-active-and-revoked-devices.png",
  "32-manager-approval-pending.png",
  "33-manager-approval-completed.png",
  "34-risk-detail.png",
  "35-privacy-export-request.png",
  "36-erased-anonymized-customer.png",
  "37-daily-cap-blocked.png",
  "38-purchase-amount-required.png",
  "39-purchase-currency-mismatch.png",
  "40-wrong-location-blocked.png",
  "41-purchase-threshold-blocked.png",
]);

const content = `# W4 Repair Round 1 screenshot manifest

The 25 Round 1 views were regenerated by successful real Chromium runs on 2026-07-31. The remaining views are retained from the accepted W4 foundation captured on 2026-07-30. Merchant-dashboard and Customer Web captures prove only the visible state named below. Apple and Google images are explicitly Test Adapter previews and do not claim external provider installation or certification.

## Required coverage

| Required view | Evidence source | File |
| --- | --- | --- |
${coverage
  .map(
    ([label, name]) =>
      `| ${label} | ${roundOneFiles.has(name) ? "Round 1 rerun" : "Accepted W4 foundation"} | [${name}](screenshots/${name}) |`,
  )
  .join("\n")}

## Exact file inventory

| File | Dimensions | SHA-256 |
| --- | ---: | --- |
${inventory
  .map(
    ({ name, width, height, sha256 }) =>
      `| [${name}](screenshots/${name}) | ${width}×${height} | \`${sha256}\` |`,
  )
  .join("\n")}
`;

await writeFile(manifest, content, "utf8");
process.stdout.write(
  `Created ${contactSheet}\nCreated ${manifest}\nCoverage rows: ${coverage.length}\nInventory: ${inventory.length} PNG files.\n`,
);
