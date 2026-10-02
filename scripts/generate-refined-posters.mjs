import sharp from "sharp";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { createQrSvg } from "../packages/qr-core/dist/index.js";

const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export async function generatePoster(scale, lang = "ar") {
  const totalW = 358;
  const totalH = 448;
  const w = totalW * scale;
  const h = totalH * scale;
  const s = (val) => val * scale;

  // QR Code
  const qrSvg = await createQrSvg("wfl1.sample.membership.000000000001", {
    width: 256,
    margin: 0,
    errorCorrectionLevel: "Q",
  });
  const cleanQrSvg = qrSvg.replace(/<\?xml.*?\?>/i, "").replace(/<!DOCTYPE.*?>/i, "");

  function renderStamp(cx, cy, r, filled) {
    if (filled) {
      return `<circle cx="${s(cx)}" cy="${s(cy)}" r="${s(r)}" fill="#E4572E"/>`;
    } else {
      return `<circle cx="${s(cx)}" cy="${s(cy)}" r="${s(r)}" fill="#F7F4EE" stroke="#241916" stroke-width="${s(2.2)}"/>`;
    }
  }

  // Refined Horizontal Margins: 22 pt on both sides!
  // Width = 314 pt (from X = 22 to X = 336 pt)
  const panelX = 22;
  const panelW = 314;
  const panelY = 86;
  const panelH = 128;

  // 8 stamps centered in 314 pt width:
  // Panel center = 22 + 157 = 179 pt
  const startX = 71;
  const colGap = 72;
  const row1Y = 120;
  const row2Y = 182;
  const r = 19;

  const stamps = [
    renderStamp(startX + 0 * colGap, row1Y, r, true),
    renderStamp(startX + 1 * colGap, row1Y, r, true),
    renderStamp(startX + 2 * colGap, row1Y, r, true),
    renderStamp(startX + 3 * colGap, row1Y, r, true),
    renderStamp(startX + 0 * colGap, row2Y, r, true),
    renderStamp(startX + 1 * colGap, row2Y, r, false),
    renderStamp(startX + 2 * colGap, row2Y, r, false),
    renderStamp(startX + 3 * colGap, row2Y, r, false),
  ].join("\n");

  // Header positioning:
  // Circle badge: center at X = 298, Y = 50, radius = 24 (spans 274 to 322 pt)
  // Right margin: 358 - 322 = 36 pt (or 298 + 24 = 322 pt)
  // Vertical line: X = 260 pt (only 14 pt to the left of the circle!)
  // Header text: right-aligned to X = 250 pt
  const badgeCx = 298;
  const dividerX = 260;
  const textEndX = 250;

  const headerContent =
    lang === "ar"
      ? `
    <!-- Arabic Header shifted right near the circle badge -->
    <line x1="${s(dividerX)}" y1="${s(30)}" x2="${s(dividerX)}" y2="${s(70)}" stroke="#C47A3D" stroke-width="${s(1.8)}" opacity="0.6"/>
    <text x="${s(textEndX)}" y="${s(40)}" text-anchor="end" font-family="${font}" font-size="${s(11.5)}" font-weight="600" fill="#241916" opacity="0.7">بطاقة الوفاء</text>
    <text x="${s(textEndX)}" y="${s(56)}" text-anchor="end" font-family="${font}" font-size="${s(14.5)}" font-weight="800" fill="#241916">Cedar Circle</text>
    <text x="${s(textEndX)}" y="${s(69)}" text-anchor="end" font-family="${font}" font-size="${s(10.5)}" font-weight="600" fill="#241916" opacity="0.8">سارة / Sara</text>

    <!-- Circle Badge -->
    <circle cx="${s(badgeCx)}" cy="${s(50)}" r="${s(24)}" fill="#C45A34"/>
    <text x="${s(badgeCx)}" y="${s(47)}" text-anchor="middle" font-family="${font}" font-size="${s(8.5)}" font-weight="600" fill="#FFFFFF" opacity="0.9">الأختام</text>
    <text x="${s(badgeCx)}" y="${s(61)}" text-anchor="middle" font-family="${font}" font-size="${s(14)}" font-weight="800" fill="#FFFFFF">5/8</text>
  `
      : `
    <!-- English Header shifted right near the circle badge -->
    <line x1="${s(dividerX)}" y1="${s(30)}" x2="${s(dividerX)}" y2="${s(70)}" stroke="#C47A3D" stroke-width="${s(1.8)}" opacity="0.6"/>
    <text x="${s(textEndX)}" y="${s(40)}" text-anchor="end" font-family="${font}" font-size="${s(11)}" font-weight="700" fill="#241916" opacity="0.65" letter-spacing="${s(0.5)}">LOYALTY CARD</text>
    <text x="${s(textEndX)}" y="${s(56)}" text-anchor="end" font-family="${font}" font-size="${s(14.5)}" font-weight="800" fill="#241916">Cedar Circle</text>
    <text x="${s(textEndX)}" y="${s(69)}" text-anchor="end" font-family="${font}" font-size="${s(11)}" font-weight="600" fill="#241916" opacity="0.8">Sara Member</text>

    <!-- Circle Badge -->
    <circle cx="${s(badgeCx)}" cy="${s(50)}" r="${s(24)}" fill="#C45A34"/>
    <text x="${s(badgeCx)}" y="${s(47)}" text-anchor="middle" font-family="${font}" font-size="${s(8.5)}" font-weight="700" fill="#FFFFFF" opacity="0.9" letter-spacing="${s(0.5)}">STAMPS</text>
    <text x="${s(badgeCx)}" y="${s(61)}" text-anchor="middle" font-family="${font}" font-size="${s(14)}" font-weight="800" fill="#FFFFFF">5/8</text>
  `;

  // Lower Section:
  // Margins: left = 22 pt, right = 22 pt. Total width = 314 pt.
  // Reward Box: width = 202 pt (from X = 22 to X = 224 pt).
  // QR Box: width = 102 pt (from X = 234 to X = 336 pt).
  // Gap between boxes = 10 pt.
  // Height = 102 pt (from Y = 224 to Y = 326 pt).
  const rewardX = 22;
  const rewardW = 202;
  const qrX = 234;
  const qrW = 102;
  const lowerY = 224;
  const lowerH = 102;

  const rewardContent =
    lang === "ar"
      ? `
    <!-- Gift Icon on the right -->
    <g transform="translate(${s(158)}, ${s(6)}) scale(${s(0.65)})">
      <path d="M20 12v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V12" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 7h20v5H2z" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 22V7" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>

    <circle cx="${s(6)}" cy="${s(18)}" r="${s(3.5)}" fill="#F3A712"/>

    <text x="${s(148)}" y="${s(14)}" text-anchor="end" font-family="${font}" font-size="${s(9.5)}" font-weight="600" fill="#241916" opacity="0.6">المكافأة</text>
    <text x="${s(148)}" y="${s(34)}" text-anchor="end" font-family="${font}" font-size="${s(13.5)}" font-weight="800" fill="#241916">هدية مجانية</text>
    <text x="${s(148)}" y="${s(52)}" text-anchor="end" font-family="${font}" font-size="${s(10)}" font-weight="700" fill="#241916" opacity="0.85">Complimentary reward</text>

    <line x1="${s(4)}" y1="${s(63)}" x2="${s(174)}" y2="${s(63)}" stroke="#EDE7DE" stroke-width="${s(0.9)}"/>
    <text x="${s(89)}" y="${s(76)}" text-anchor="middle" font-family="${font}" font-size="${s(9)}" font-weight="600" fill="#C45A34">3 طوابع متبقية للمكافأة</text>
  `
      : `
    <!-- Gift Icon on the right -->
    <g transform="translate(${s(158)}, ${s(6)}) scale(${s(0.65)})">
      <path d="M20 12v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V12" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 7h20v5H2z" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 22V7" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" fill="none" stroke="#241916" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>

    <circle cx="${s(6)}" cy="${s(18)}" r="${s(3.5)}" fill="#F3A712"/>

    <text x="${s(148)}" y="${s(14)}" text-anchor="end" font-family="${font}" font-size="${s(9)}" font-weight="700" fill="#241916" opacity="0.6" letter-spacing="${s(0.4)}">REWARD</text>
    <text x="${s(148)}" y="${s(34)}" text-anchor="end" font-family="${font}" font-size="${s(13.5)}" font-weight="800" fill="#241916">Free Beverage</text>
    <text x="${s(148)}" y="${s(52)}" text-anchor="end" font-family="${font}" font-size="${s(9.5)}" font-weight="600" fill="#241916" opacity="0.75">Complimentary choice</text>

    <line x1="${s(4)}" y1="${s(63)}" x2="${s(174)}" y2="${s(63)}" stroke="#EDE7DE" stroke-width="${s(0.9)}"/>
    <text x="${s(89)}" y="${s(76)}" text-anchor="middle" font-family="${font}" font-size="${s(9)}" font-weight="700" fill="#C45A34">3 stamps remaining</text>
  `;

  // QR Code inside container (qrX = 234, qrW = 102):
  // QR size: 76 pt
  // Center of QR box = 234 + 51 = 285 pt
  // Left of QR = 285 - 38 = 247 pt
  const qrLeft = 247;
  const qrTop = 232;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <radialGradient id="top-ambient-${lang}" cx="80%" cy="15%" r="45%">
        <stop offset="0%" stop-color="#E4572E" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#E4572E" stop-opacity="0"/>
      </radialGradient>
      <filter id="shadow-${lang}" x="-5%" y="-5%" width="110%" height="115%" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="${s(2)}" stdDeviation="${s(3)}" flood-color="#000000" flood-opacity="0.06"/>
      </filter>
    </defs>

    <!-- Full Canvas Background (358 x 448) -->
    <rect width="${w}" height="${h}" fill="#F7F4EE"/>
    <rect width="${w}" height="${h}" fill="url(#top-ambient-${lang})"/>

    <!-- Decorative Top Line -->
    <path d="M${s(22)} ${s(32)} C ${s(105)} ${s(18)}, ${s(190)} ${s(48)}, ${s(336)} ${s(24)}"
          fill="none" stroke="#F3A712" stroke-width="${s(1.5)}" stroke-linecap="round" opacity="0.35"/>

    <!-- Header Section (shifted right next to circle badge) -->
    ${headerContent}

    <!-- Stamp Panel (margins 22 pt, width 314, height 128) -->
    <rect x="${s(panelX)}" y="${s(panelY)}" width="${s(panelW)}" height="${s(panelH)}" rx="${s(18)}" fill="#E9E4DB" opacity="0.65"/>
    ${stamps}

    <!-- Reward Box (Left, y: 224 to 326, height: 102, width: 202) -->
    <g filter="url(#shadow-${lang})">
      <rect x="${s(rewardX)}" y="${s(lowerY)}" width="${s(rewardW)}" height="${s(lowerH)}" rx="${s(14)}" fill="#FFFFFF" opacity="0.96"/>
      <rect x="${s(rewardX)}" y="${s(lowerY)}" width="${s(rewardW)}" height="${s(lowerH)}" rx="${s(14)}" fill="none" stroke="#E3DDD4" stroke-width="${s(1)}"/>
    </g>

    <!-- Reward Content -->
    <g transform="translate(${s(rewardX + 8)}, ${s(lowerY + 12)})">
      ${rewardContent}
    </g>

    <!-- QR Code Box (Right, y: 224 to 326, height: 102, width: 102) -->
    <g filter="url(#shadow-${lang})">
      <rect x="${s(qrX)}" y="${s(lowerY)}" width="${s(qrW)}" height="${s(lowerH)}" rx="${s(14)}" fill="#FFFFFF" opacity="0.96"/>
      <rect x="${s(qrX)}" y="${s(lowerY)}" width="${s(qrW)}" height="${s(lowerH)}" rx="${s(14)}" fill="none" stroke="#E3DDD4" stroke-width="${s(1)}"/>
    </g>

    <!-- Centered QR Code inside its container -->
    <g transform="translate(${s(qrLeft)}, ${s(qrTop)})">
      <svg width="${s(76)}" height="${s(76)}" viewBox="0 0 256 256">
        ${cleanQrSvg}
      </svg>
      <text x="${s(38)}" y="${s(86)}" text-anchor="middle" font-family="${font}" font-size="${s(7.5)}" font-weight="700" fill="#241916" opacity="0.5" letter-spacing="${s(0.4)}">SCAN TO EARN</text>
    </g>

  </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Generate test 2x posters for both languages and simulate in Apple Wallet
const artifactDir =
  "C:/Users/Alhamza Nazhan/.gemini/antigravity-ide/brain/ef67bc55-1ee8-473d-ae21-5eaaee7eb052";

const ar2x = await generatePoster(2, "ar");
await writeFile(join(artifactDir, "refined_poster_ar@2x.png"), ar2x);

const en2x = await generatePoster(2, "en");
await writeFile(join(artifactDir, "refined_poster_en@2x.png"), en2x);

// Simulate in Apple Wallet
const refBuf = await readFile(
  "C:/WafloProject/apple-wallet/diagnostic/ios27-poster-final-production-candidate.pkpass",
);
const refEntries = unzipSync(refBuf);
const logoBuf = refEntries["primaryLogo@2x.png"];

const sheetSvg = Buffer.from(`
<svg width="716" height="896">
  <rect y="676" width="716" height="220" fill="#F4F2EE" fill-opacity="0.98"/>
  <rect y="676" width="716" height="1.5" fill="#E2DDD5"/>
  <text x="358" y="720" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="22" font-weight="600" fill="#241916" opacity="0.6">Apple Wallet Native Card Details</text>
  <text x="358" y="750" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="18" fill="#241916" opacity="0.4">Y = 338 pt Cutoff Line</text>
</svg>
`);

const simAr = await sharp(ar2x)
  .composite([
    { input: logoBuf, top: 48, left: 44 },
    { input: sheetSvg, top: 0, left: 0 },
  ])
  .png()
  .toBuffer();
await writeFile(join(artifactDir, "simulated_refined_ar.png"), simAr);

const simEn = await sharp(en2x)
  .composite([
    { input: logoBuf, top: 48, left: 44 },
    { input: sheetSvg, top: 0, left: 0 },
  ])
  .png()
  .toBuffer();
await writeFile(join(artifactDir, "simulated_refined_en.png"), simEn);

console.log("Generated both Arabic and English refined posters & simulations!");
