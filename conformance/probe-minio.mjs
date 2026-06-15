// Derisking probe: does MinIO honor the two conditional-write features the S3 adapter's
// etag-CAS depends on — putIfAbsent (If-None-Match: *) and putIfMatch (If-Match: <etag>)?
// If either is silently accepted (no 412), MinIO cannot enforce the CAS and is not a viable
// S3 conformance fixture. Cheap to find out before building the full harness.
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "http://127.0.0.1:9100",
  region: "us-east-1",
  credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  forcePathStyle: true,
});

const BUCKET = "probe";
const is412 = (e) => e?.name === "PreconditionFailed" || e?.$metadata?.httpStatusCode === 412;

const main = async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch {
    /* bucket may already exist */
  }

  const key = `k-${process.pid}-${Math.floor(performance.now())}`;

  // putIfAbsent: create-only.
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "v1", IfNoneMatch: "*" }));
  let absentRejected = false;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "v2", IfNoneMatch: "*" }));
  } catch (e) {
    absentRejected = is412(e);
    if (!absentRejected) throw e;
  }
  console.log("putIfAbsent (If-None-Match:*) rejects on existing key:", absentRejected);

  // putIfMatch: overwrite-only-if-etag-matches.
  const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "v3", IfMatch: got.ETag }));
  let matchRejected = false;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "v4", IfMatch: '"deadbeef"' }));
  } catch (e) {
    matchRejected = is412(e);
    if (!matchRejected) throw e;
  }
  console.log("putIfMatch (If-Match:etag) rejects on stale etag:", matchRejected);

  const viable = absentRejected && matchRejected;
  console.log("\nMINIO_CONDITIONAL_WRITES_VIABLE:", viable);
  process.exit(viable ? 0 : 1);
};

main().catch((e) => {
  console.error("PROBE ERROR:", e?.name, e?.message);
  process.exit(2);
});
