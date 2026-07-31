import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "../apps/api/node_modules/sharp/dist/index.mjs";

const root = process.cwd();
const handoffDirectory = resolve(root, "artifacts/handoff-w3-round-2");
const screenshotDirectory = resolve(handoffDirectory, "screenshots");
const contactSheet = resolve(screenshotDirectory, "00-contact-sheet.png");
const manifest = resolve(handoffDirectory, "SCREENSHOT-MANIFEST.md");

const coverage = [
  ["Merchant enrollment settings", "01-merchant-enrollment-settings.png"],
  ["Public URL and Enrollment QR", "02-public-url-and-enrollment-qr.png"],
  ["Multiple-program chooser", "03-program-chooser.png"],
  ["Multiple-program chooser, Arabic", "03b-program-chooser-arabic.png"],
  ["Single-program root, Arabic canonical route", "03a-single-program-root-arabic.png"],
  ["English join page with selected empty artwork", "04-english-join-page.png"],
  ["Arabic RTL join page with selected empty artwork", "05-arabic-rtl-join-page.png"],
  ["Optional email enrollment", "07-optional-email-enrollment.png"],
  ["Consent validation error", "06-consent-validation-error.png"],
  [
    "Name-only enrollment outcome, Customer card 0/8, and opaque Membership QR",
    "08-customer-card-0-of-8-membership-qr.png",
  ],
  ["Customer Wallet readiness (Test Adapters)", "09-apple-google-ready-test-adapter.png"],
  ["Provider disabled", "15-provider-disabled.png"],
  ["Paused Program", "18-paused-program.png"],
  ["Archived Program", "19-archived-program.png"],
  ["Suspended merchant", "20-suspended-merchant.png"],
  ["Transfer entry with scan and QR-upload options", "19-transfer-entry-options.png"],
  ["Email transfer pending", "14-email-transfer-pending.png"],
  ["Email transfer confirmed", "15-email-transfer-confirmed.png"],
  ["No-email warning", "11-no-email-security-warning.png"],
  ["No-email transfer confirmed", "12-no-email-transfer-confirmed-new-card.png"],
  ["Old card transferred", "17-old-card-transferred.png"],
  ["New card active", "16-new-card-active.png"],
  ["Version-pinned existing Membership", "29-version-pinned-existing-membership.png"],
  ["New-version enrollment", "30-new-version-enrollment.png"],
  ["Wallet setup page", "31-wallet-setup-page.png"],
  ["Arabic Customer Card", "32-arabic-customer-card.png"],
  ["Accessible error state", "33-accessible-error-state.png"],
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
  return basename(name, ".png").replace(/^\d+-/u, "").replace(/^w3-/u, "").replaceAll("-", " ");
}

await mkdir(screenshotDirectory, { recursive: true });
const files = (await readdir(screenshotDirectory))
  .filter((name) => name.endsWith(".png") && name !== "00-contact-sheet.png")
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

for (const [, name] of coverage) {
  if (!files.includes(name)) throw new Error(`Required screenshot is missing: ${name}`);
}

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
          Waflo W3 repair round 2 browser evidence
        </text>
        <text x="0" y="65" font-family="Arial, sans-serif" font-size="18" fill="#6b4a3d">
          Enrollment, private card, Wallet readiness, transfer, lifecycle, RTL, and accessibility
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

const content = `# W3 screenshot manifest

Generated from real Chromium runs on 2026-07-29. Browser screenshots prove only the visible Customer Web or merchant-dashboard state named below. They are not relabeled as Apple passes or Google objects. Provider package and mapping proof is kept separately under \`provider-artifacts/\`. Test Adapter labels are intentional and do not claim real provider installation.

## Required coverage

| Required view | File |
| --- | --- |
${coverage.map(([label, name]) => `| ${label} | [${name}](screenshots/${name}) |`).join("\n")}

## File inventory

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
  `Created ${contactSheet}\nCreated ${manifest}\nInventory: ${inventory.length} PNG files.\n`,
);
