import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { optionalEnv, requireEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __unityAppealsS3Client: S3Client | undefined;
}

function getS3Client(): S3Client {
  if (!global.__unityAppealsS3Client) {
    global.__unityAppealsS3Client = new S3Client({
      region: optionalEnv("AWS_REGION") ?? "us-east-1",
    });
  }
  return global.__unityAppealsS3Client;
}

export function getDocumentsBucketName(): string {
  return requireEnv("DOCUMENTS_BUCKET_NAME");
}

export async function uploadDocumentArtifact(params: {
  key: string;
  body: Uint8Array;
  contentType: string;
}) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getDocumentsBucketName(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ServerSideEncryption: "AES256",
    }),
  );
}

export async function createDownloadUrl(params: {
  key: string;
  fileName: string;
  expiresInSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getDocumentsBucketName(),
      Key: params.key,
      ResponseContentDisposition: `attachment; filename="${params.fileName}"`,
    }),
    { expiresIn: params.expiresInSeconds ?? 900 },
  );
}
