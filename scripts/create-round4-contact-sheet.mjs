import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import sharp from "../apps/api/node_modules/sharp/dist/index.mjs";

const screenshotDirectory = resolve(process.argv[2] ?? "artifacts/handoff-w2-round-4/screenshots");
const output = resolve(
  process.argv[3] ?? "artifacts/handoff-w2-round-4/w2-round4-contact-sheet.png",
);

const files = (await readdir(screenshotDirectory))
  .filter((name) => /^\d+-r4-.*\.png$/u.test(name))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

if (!files.length) throw new Error("No Round 4 screenshots were found.");

const columns = 3;
const tileWidth = 560;
const imageHeight = 472;
const captionHeight = 72;
const gap = 24;
const margin = 36;
const titleHeight = 86;
const rows = Math.ceil(files.length / columns);
const width = margin * 2 + columns * tileWidth + (columns - 1) * gap;
const height = margin * 2 + titleHeight + rows * (imageHeight + captionHeight) + (rows - 1) * gap;

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function caption(name) {
  return basename(name, ".png")
    .replace(/^\d+-r4-/u, "")
    .replaceAll("-", " ");
}

const composites = [
  {
    input: Buffer.from(`
      <svg width="${width}" height="${titleHeight}">
        <text x="0" y="36" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#2b1914">
          Waflo W2 Round 4 evidence
        </text>
        <text x="0" y="68" font-family="Arial, sans-serif" font-size="19" fill="#6b4a3d">
          Domain integrity, entitlements, lifecycle, assets, PATCH preservation, and reward reset
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
    .resize(tileWidth, imageHeight, {
      fit: "contain",
      background: "#f8f5f2",
    })
    .png()
    .toBuffer();
  composites.push({ input: thumbnail, left, top });
  composites.push({
    input: Buffer.from(`
      <svg width="${tileWidth}" height="${captionHeight}">
        <rect width="${tileWidth}" height="${captionHeight}" fill="#2b1914"/>
        <text x="18" y="29" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff">
          ${escapeXml(name.slice(0, 2))}
        </text>
        <text x="18" y="54" font-family="Arial, sans-serif" font-size="17" fill="#f8dfd4">
          ${escapeXml(caption(name))}
        </text>
      </svg>
    `),
    left,
    top: top + imageHeight,
  });
}

await mkdir(dirname(output), { recursive: true });
await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: "#efe8e3",
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(output);

process.stdout.write(`Created ${output}\nIncluded ${files.length} screenshots.\n`);
