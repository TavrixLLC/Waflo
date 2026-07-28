import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ObjectStorage {
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  signedReadUrl(objectKey: string, expiresInSeconds: number): string;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(
    private readonly root = join(process.cwd(), "tmp", "waflo-object-storage"),
    private readonly signingSecret = process.env.WAFLO_OBJECT_SIGNING_SECRET ??
      "local-development-only",
  ) {}

  async put(objectKey: string, bytes: Buffer) {
    const target = join(this.root, objectKey.replace(/^[/\\]+/, ""));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "w" });
  }

  get(objectKey: string) {
    return readFile(join(this.root, objectKey.replace(/^[/\\]+/, "")));
  }

  signedReadUrl(objectKey: string, expiresInSeconds: number) {
    const expires = Math.floor(Date.now() / 1000) + Math.max(1, Math.min(expiresInSeconds, 3600));
    const payload = `${objectKey}:${expires}`;
    const signature = createHmac("sha256", this.signingSecret).update(payload).digest("hex");
    return `/v1/object-storage/read?key=${encodeURIComponent(objectKey)}&expires=${expires}&signature=${signature}`;
  }

  verifySignature(objectKey: string, expires: number, signature: string) {
    if (expires < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac("sha256", this.signingSecret)
      .update(`${objectKey}:${expires}`)
      .digest("hex");
    return (
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    );
  }
}
