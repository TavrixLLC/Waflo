import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync, unzipSync } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { Pkcs7ApplePassSigner } from "../packages/wallet-apple/dist/index.js";
import { generatePoster } from "./generate-refined-posters.mjs";
import { generateEnglishLtrPoster } from "./generate-english-ltr.mjs";

const appleWalletDir = "C:/WafloProject/apple-wallet";

// 1. Read Signing Credentials
const p12Bytes = await readFile(join(appleWalletDir, "apple-wallet-pass.p12"));
const password = (
  await readFile(join(appleWalletDir, "secrets", "pass-p12-password.txt"), "utf8")
).trim();
const wwdrPem = await readFile(join(appleWalletDir, "apple-wwdr.pem"), "utf8");
const signer = new Pkcs7ApplePassSigner(p12Bytes, password, wwdrPem);

// 2. Read Reference Logos & Icons
const refBuf = await readFile(
  join(appleWalletDir, "diagnostic", "ios27-poster-final-production-candidate.pkpass"),
);
const refEntries = unzipSync(refBuf);

console.log("Generating 1x, 2x, 3x Artwork for Arabic Poster...");
const ar1x = await generatePoster(1, "ar");
const ar2x = await generatePoster(2, "ar");
const ar3x = await generatePoster(3, "ar");

console.log("Generating 1x, 2x, 3x Artwork for English LTR Poster (Option A)...");
const enA1x = await generateEnglishLtrPoster(1, "connected-left");
const enA2x = await generateEnglishLtrPoster(2, "connected-left");
const enA3x = await generateEnglishLtrPoster(3, "connected-left");

console.log("Generating 1x, 2x, 3x Artwork for English LTR Poster (Option B)...");
const enB1x = await generateEnglishLtrPoster(1, "connected-right");
const enB2x = await generateEnglishLtrPoster(2, "connected-right");
const enB3x = await generateEnglishLtrPoster(3, "connected-right");

function makeArabicPassJson() {
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.app.waflo.loyalty",
    serialNumber: `waflo.ios27.ar.${Date.now()}.${randomUUID().slice(0, 8)}`,
    teamIdentifier: "A28KQ579D2",
    organizationName: "Waflo Coffee",
    description: "بطاقة ولاء Waflo - Cedar Circle",
    backgroundColor: "rgb(247, 244, 238)",
    foregroundColor: "rgb(36, 25, 22)",
    labelColor: "rgb(36, 25, 22)",
    footerBackgroundColor: "rgb(247, 244, 238)",
    webServiceURL: "https://api.waflo.app/v1/apple-wallet",
    authenticationToken: "a".repeat(43),
    voided: false,
    posterGeneric: {
      backFields: [
        {
          key: "program",
          label: "البرنامج",
          value: "بطاقة الوفاء / Cedar Circle",
        },
        {
          key: "member",
          label: "العضو",
          value: "سارة / Sara",
        },
        {
          key: "status",
          label: "الحالة",
          value: "نشطة (Active)",
        },
        {
          key: "progress_detail",
          label: "الأختام",
          value: "5 / 8 طوابع محققة",
        },
        {
          key: "reward",
          label: "المكافأة",
          value: "هدية مجانية / Complimentary reward (3 طوابع متبقية)",
        },
        {
          key: "security",
          label: "الأمان",
          value: "بيانات اعتماد مشفرة لبرنامج الولاء من Waflo.",
        },
        {
          key: "operator",
          label: "المشغل",
          value: "Waflo is owned and operated by Tavrix LLC.",
        },
      ],
    },
  };
}

function makeEnglishPassJson(subtitle = "English LTR") {
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.app.waflo.loyalty",
    serialNumber: `waflo.ios27.en.${Date.now()}.${randomUUID().slice(0, 8)}`,
    teamIdentifier: "A28KQ579D2",
    organizationName: "Waflo Coffee",
    description: `Waflo Loyalty Pass - Cedar Circle (${subtitle})`,
    backgroundColor: "rgb(247, 244, 238)",
    foregroundColor: "rgb(36, 25, 22)",
    labelColor: "rgb(36, 25, 22)",
    footerBackgroundColor: "rgb(247, 244, 238)",
    webServiceURL: "https://api.waflo.app/v1/apple-wallet",
    authenticationToken: "a".repeat(43),
    voided: false,
    posterGeneric: {
      backFields: [
        {
          key: "program",
          label: "Program",
          value: "Cedar Circle Loyalty Card",
        },
        {
          key: "member",
          label: "Member",
          value: "Sara",
        },
        {
          key: "status",
          label: "Status",
          value: "Active",
        },
        {
          key: "progress_detail",
          label: "Stamps",
          value: "5 of 8 completed",
        },
        {
          key: "reward",
          label: "Reward",
          value: "Free Beverage / Complimentary reward (3 stamps remaining)",
        },
        {
          key: "security",
          label: "Security",
          value: "Encrypted loyalty pass credentials by Waflo.",
        },
        {
          key: "operator",
          label: "Operator",
          value: "Waflo is owned and operated by Tavrix LLC.",
        },
      ],
    },
  };
}

async function signAndSave(entries, filename) {
  const manifest = {};
  for (const [name, content] of Object.entries(entries)) {
    if (name === "manifest.json" || name === "signature") continue;
    manifest[name] = createHash("sha1").update(content).digest("hex");
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  entries["manifest.json"] = manifestBytes;
  entries["signature"] = await signer.signManifest(manifestBytes);

  const buffer = Buffer.from(zipSync(entries, { level: 9 }));
  const outPath = join(appleWalletDir, filename);
  await writeFile(outPath, buffer);
  console.log(`Saved ${filename}, size: ${buffer.length} bytes`);
}

// 1. Arabic Packages (Refined 24pt margins, right-aligned header next to circle)
const arEntries = {
  "pass.json": Buffer.from(JSON.stringify(makeArabicPassJson(), null, 2), "utf8"),
  "artwork.png": ar1x,
  "artwork@2x.png": ar2x,
  "artwork@3x.png": ar3x,
  "primaryLogo.png": refEntries["primaryLogo.png"],
  "primaryLogo@2x.png": refEntries["primaryLogo@2x.png"],
  "primaryLogo@3x.png": refEntries["primaryLogo@3x.png"],
  "icon.png": refEntries["icon.png"],
  "icon@2x.png": refEntries["icon@2x.png"],
  "icon@3x.png": refEntries["icon@3x.png"],
};

await signAndSave(arEntries, "waflo-ios27-ar.pkpass");
await signAndSave(arEntries, "waflo-ios27-poster.pkpass");
await signAndSave(arEntries, "waflo-ios27-safe.pkpass");

// 2. English LTR Package Option A (Balanced LTR layout)
const enAEntries = {
  "pass.json": Buffer.from(
    JSON.stringify(makeEnglishPassJson("Option A - Balanced LTR"), null, 2),
    "utf8",
  ),
  "artwork.png": enA1x,
  "artwork@2x.png": enA2x,
  "artwork@3x.png": enA3x,
  "primaryLogo.png": refEntries["primaryLogo.png"],
  "primaryLogo@2x.png": refEntries["primaryLogo@2x.png"],
  "primaryLogo@3x.png": refEntries["primaryLogo@3x.png"],
  "icon.png": refEntries["icon.png"],
  "icon@2x.png": refEntries["icon@2x.png"],
  "icon@3x.png": refEntries["icon@3x.png"],
};
await signAndSave(enAEntries, "waflo-ios27-en.pkpass");

// 3. English LTR Package Option B (Grouped near badge)
const enBEntries = {
  "pass.json": Buffer.from(
    JSON.stringify(makeEnglishPassJson("Option B - Grouped Badge"), null, 2),
    "utf8",
  ),
  "artwork.png": enB1x,
  "artwork@2x.png": enB2x,
  "artwork@3x.png": enB3x,
  "primaryLogo.png": refEntries["primaryLogo.png"],
  "primaryLogo@2x.png": refEntries["primaryLogo@2x.png"],
  "primaryLogo@3x.png": refEntries["primaryLogo@3x.png"],
  "icon.png": refEntries["icon.png"],
  "icon@2x.png": refEntries["icon@2x.png"],
  "icon@3x.png": refEntries["icon@3x.png"],
};
await signAndSave(enBEntries, "waflo-ios27-en-grouped.pkpass");

console.log("All Arabic and English LTR packages signed and packaged successfully!");
