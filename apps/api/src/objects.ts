import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * LOCAL ADAPTER.
 * In-memory bytes stand in for a private bucket during tests and local runs
 * without MinIO. assertRuntimeSafe refuses this adapter when NODE_ENV=production.
 */
export class MemoryObjectStore {
  readonly kind = "memory" as const;
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class S3ObjectStore {
  readonly kind = "s3" as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return result.Body.transformToByteArray();
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async presignPut(key: string, contentType: string, expiresIn: number, byteCount: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: byteCount,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async presignGet(key: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}

export type ObjectStore = MemoryObjectStore | S3ObjectStore;

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  return error.name === "NoSuchKey" || error.name === "NotFound";
}

export function createObjectStoreFromEnv(env: NodeJS.ProcessEnv): ObjectStore {
  const driver = env.OBJECT_STORE ?? "memory";
  if (driver === "memory") return new MemoryObjectStore();
  if (driver !== "s3") {
    throw new Error(`Unsupported OBJECT_STORE "${driver}". Use "memory" or "s3".`);
  }
  const endpoint = required(env.S3_ENDPOINT, "S3_ENDPOINT");
  const bucket = required(env.S3_BUCKET, "S3_BUCKET");
  const region = env.S3_REGION ?? "us-east-1";
  const accessKeyId = required(env.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID");
  const secretAccessKey = required(env.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY");
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return new S3ObjectStore(client, bucket);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the S3 object store.`);
  return value;
}
