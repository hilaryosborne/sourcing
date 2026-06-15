// Concrete S3ClientPort over the AWS SDK, pointed at MinIO — the Phase D S3 fixture. The
// conformance suite is adapter-blind; this is the only S3-specific code, and it lives in the
// fixture, never in an assertion. Probed viable: MinIO honors If-None-Match:* and If-Match.
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import type { S3ClientPort } from "@hilaryosborne/sourcing-adapter-s3";

const ENDPOINT = "http://127.0.0.1:9100";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  forcePathStyle: true,
});

const is412 = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "PreconditionFailed" || e?.$metadata?.httpStatusCode === 412;
};
const is404 = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
};

export const ensureBucket = async (bucket: string): Promise<void> => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch {
    /* already owned — idempotent */
  }
};

export const minioS3Client = (): S3ClientPort => ({
  get: async (bucket, key) => {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await res.Body!.transformToString();
      return { body, etag: res.ETag! };
    } catch (error) {
      if (is404(error)) return undefined;
      throw error;
    }
  },
  putIfAbsent: async (bucket, key, body) => {
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, IfNoneMatch: "*" }));
      return true;
    } catch (error) {
      if (is412(error)) return false;
      throw error;
    }
  },
  putIfMatch: async (bucket, key, body, etag) => {
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, IfMatch: etag }));
      return true;
    } catch (error) {
      if (is412(error)) return false;
      throw error;
    }
  },
  put: async (bucket, key, body) => {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  },
  list: async (bucket, prefix) => {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    return (res.Contents ?? []).map((object) => object.Key!).filter(Boolean);
  },
  delete: async (bucket, keys) => {
    if (keys.length === 0) return;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  },
});
