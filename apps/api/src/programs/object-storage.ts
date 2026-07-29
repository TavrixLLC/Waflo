import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

export interface ObjectStorage {
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  putImmutable(objectKey: string, bytes: Buffer, contentType: string): Promise<"STORED" | "EXISTS">;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  ensureReady(): Promise<void>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export interface S3ObjectStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectStorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async ensureReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    }
  }

  async put(objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: contentType,
        CacheControl: "private, no-store",
      }),
    );
  }

  async putImmutable(
    objectKey: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<"STORED" | "EXISTS"> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "private, immutable, max-age=31536000",
          IfNoneMatch: "*",
        }),
      );
      return "STORED";
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412)
        return "EXISTS";
      throw error;
    }
  }

  async get(objectKey: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
    if (!response.Body) throw new Error("Object storage returned an empty body.");
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
  }
}
