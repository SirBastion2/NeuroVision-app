import { Buffer } from "node:buffer";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { one, type Database } from "./db.js";

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

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
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

/**
 * Durable fallback when S3/MinIO env vars are absent. Trace bytes live in Postgres.
 */
export class PostgresObjectStore {
  readonly kind = "postgres" as const;

  constructor(private readonly db: Database) {}

  async put(key: string, body: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    await this.db.query(
      `INSERT INTO object_blobs (object_key, body, content_type) VALUES ($1, $2, $3)
       ON CONFLICT (object_key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type`,
      [key, Buffer.from(body), contentType],
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    const row = await one<{ body: Buffer | Uint8Array | string }>(
      this.db,
      "SELECT body FROM object_blobs WHERE object_key = $1",
      [key],
    );
    if (!row) return null;
    return bytesOf(row.body);
  }

  async delete(key: string): Promise<void> {
    await this.db.query("DELETE FROM object_blobs WHERE object_key = $1", [key]);
  }
}

export type ObjectStore = MemoryObjectStore | S3ObjectStore | PostgresObjectStore;

function bytesOf(value: Buffer | Uint8Array | string): Uint8Array {
  if (typeof value === "string") return Uint8Array.from(Buffer.from(value, "base64"));
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  return error.name === "NoSuchKey" || error.name === "NotFound";
}

function hasS3Config(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

export function createObjectStoreFromEnv(env: NodeJS.ProcessEnv, db?: Database): ObjectStore {
  const requested = env.OBJECT_STORE?.trim().toLowerCase();
  const driver = requested || (hasS3Config(env) ? "s3" : db ? "postgres" : "memory");
  if (driver === "memory") return new MemoryObjectStore();
  if (driver === "postgres") {
    if (!db) return new MemoryObjectStore();
    return new PostgresObjectStore(db);
  }
  if (driver !== "s3") {
    throw new Error(`Unsupported OBJECT_STORE "${driver}". Use "memory", "postgres", or "s3".`);
  }
  if (!hasS3Config(env)) {
    if (db) return new PostgresObjectStore(db);
    return new MemoryObjectStore();
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
