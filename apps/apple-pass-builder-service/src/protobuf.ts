import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import protobuf from "protobufjs";
import {
  type ImageVariants,
  type PassBuilderImageSlot,
  type PassBuilderRequest,
  passBuilderImageSlots,
} from "./contracts.js";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const expectedImageSizes: Readonly<
  Record<PassBuilderImageSlot, readonly [width: number, height: number]>
> = {
  icon: [38, 38],
  logo: [38, 38],
  primaryLogo: [126, 30],
  artwork: [358, 448],
  strip: [375, 144],
};

const barcodeFormats: Readonly<Record<PassBuilderRequest["pass"]["barcode"]["format"], number>> = {
  QR: 1,
  PDF417: 2,
  AZTEC: 3,
  CODE128: 4,
  EAN13: 5,
  CODABAR: 6,
  CODE39: 7,
  I2OF5: 8,
};

function rgb(hex: string) {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16) / 255,
    green: Number.parseInt(hex.slice(3, 5), 16) / 255,
    blue: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

function decodePng(value: string, slot: PassBuilderImageSlot, scale: 1 | 2 | 3): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 24 || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`PASS_IMAGE_INVALID:${slot}:${scale}`);
  }
  const [baseWidth, baseHeight] = expectedImageSizes[slot];
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== baseWidth * scale || height !== baseHeight * scale) {
    throw new Error(`PASS_IMAGE_DIMENSIONS_INVALID:${slot}:${scale}`);
  }
  if (bytes.length > 4_000_000) throw new Error(`PASS_IMAGE_TOO_LARGE:${slot}:${scale}`);
  return bytes;
}

async function writeImageSet(
  assetsDirectory: string,
  slot: PassBuilderImageSlot,
  variants: ImageVariants,
) {
  const output: Record<string, { imagePath: string }> = {};
  for (const scale of [1, 2, 3] as const) {
    const key = `times${scale}` as const;
    const path = join(assetsDirectory, `${slot}${scale === 1 ? "" : `@${scale}x`}.png`);
    await writeFile(path, decodePng(variants[key], slot, scale), { mode: 0o600, flag: "wx" });
    output[key] = { imagePath: path };
  }
  return output;
}

export async function createPersonalizationProtobuf(input: {
  readonly request: PassBuilderRequest;
  readonly protobufRoot: string;
  readonly workDirectory: string;
}): Promise<string> {
  const assetsDirectory = join(input.workDirectory, "assets");
  await mkdir(assetsDirectory, { mode: 0o700 });
  const suppliedImageSets = passBuilderImageSlots.flatMap((slot) => {
    const variants = input.request.images[slot];
    return variants ? [{ slot, variants }] : [];
  });
  const imageSets = Object.fromEntries(
    await Promise.all(
      suppliedImageSets.map(async ({ slot, variants }) => [
        slot,
        await writeImageSet(assetsDirectory, slot, variants),
      ]),
    ),
  );
  const schema = await protobuf.load(resolve(input.protobufRoot, "PassPackage.proto"));
  const type = schema.lookupType("pass.PassPackage");
  const fields = input.request.pass.fieldValues;
  const message = type.fromObject({
    pass: {
      serialNumber: input.request.pass.serialNumber,
      webServiceUrl: input.request.pass.webServiceURL,
      authenticationToken: input.request.pass.authenticationToken,
      passTypeIdentifier: input.request.pass.passTypeIdentifier,
      teamIdentifier: input.request.pass.teamIdentifier,
      organizationName: input.request.pass.organizationName,
      description: input.request.pass.description,
      voided: input.request.pass.voided,
      fields: {
        fieldCustomization: {
          valueForKey: Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [key, { valueText: value }]),
          ),
        },
      },
      barcodes: [
        {
          format: barcodeFormats[input.request.pass.barcode.format],
          message: input.request.pass.barcode.message,
          messageEncoding: input.request.pass.barcode.messageEncoding,
        },
      ],
      backgroundColor: rgb(input.request.pass.backgroundColor),
      foregroundColor: rgb(input.request.pass.foregroundColor),
      labelColor: rgb(input.request.pass.labelColor),
      logoText: input.request.pass.logoText,
    },
    ...imageSets,
  });
  const verificationError = type.verify(message);
  if (verificationError) throw new Error(`PASS_PROTOBUF_INVALID:${verificationError}`);
  const outputPath = join(input.workDirectory, "personalization.pb");
  await writeFile(outputPath, type.encode(message).finish(), { mode: 0o600, flag: "wx" });
  return outputPath;
}

export { expectedImageSizes };
