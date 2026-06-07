import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "@/lib/config/env";

type UploadObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type StoredObject = {
  body: Uint8Array;
  contentType: string;
};

function sanitizeKeySegment(value: string) {
  return value.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

function getLocalUploadRoot() {
  return path.join(process.cwd(), ".uploads");
}

function resolveLocalPath(key: string) {
  const normalizedKey = sanitizeKeySegment(key);
  const absolutePath = path.resolve(getLocalUploadRoot(), normalizedKey);
  const root = path.resolve(getLocalUploadRoot());

  if (!absolutePath.startsWith(root)) {
    throw new Error("Invalid storage key.");
  }

  return absolutePath;
}

function getS3Client() {
  const config = env();
  if (config.STORAGE_DRIVER !== "s3") {
    throw new Error("S3 storage is not enabled.");
  }

  return new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

export function getStorageDriver() {
  return env().STORAGE_DRIVER;
}

export function canUploadTaskAttachments() {
  const config = env();
  if (config.STORAGE_DRIVER === "disabled") {
    return false;
  }
  if (config.IS_PRODUCTION) {
    return config.STORAGE_DRIVER === "s3" && config.STORAGE_CONFIGURED;
  }
  return true;
}

export async function uploadStorageObject(input: UploadObjectInput) {
  const config = env();
  const key = sanitizeKeySegment(input.key);

  if (config.STORAGE_DRIVER === "disabled") {
    throw new Error("Task proof uploads are disabled.");
  }

  if (config.STORAGE_DRIVER === "local") {
    const targetPath = resolveLocalPath(key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.body);
    return { key };
  }

  if (!config.STORAGE_CONFIGURED) {
    throw new Error("Task proof storage is not configured.");
  }

  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
    })
  );

  return { key };
}

export async function readStorageObject(key: string, contentType: string): Promise<StoredObject> {
  const config = env();
  const normalizedKey = sanitizeKeySegment(key);

  if (config.STORAGE_DRIVER === "local") {
    const targetPath = resolveLocalPath(normalizedKey);
    const body = await readFile(targetPath);
    return {
      body: new Uint8Array(body),
      contentType,
    };
  }

  if (config.STORAGE_DRIVER !== "s3" || !config.STORAGE_CONFIGURED) {
    throw new Error("Task proof storage is not configured.");
  }

  const client = getS3Client();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
    })
  );

  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error("Stored file could not be read.");
  }

  return {
    body: bytes,
    contentType: result.ContentType || contentType,
  };
}

export async function deleteStorageObject(key: string) {
  const config = env();
  const normalizedKey = sanitizeKeySegment(key);

  if (config.STORAGE_DRIVER === "local") {
    const targetPath = resolveLocalPath(normalizedKey);
    await rm(targetPath, { force: true });
    return;
  }

  if (config.STORAGE_DRIVER !== "s3" || !config.STORAGE_CONFIGURED) {
    return;
  }

  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
    })
  );
}
