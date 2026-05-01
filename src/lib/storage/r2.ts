import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageBackend } from "./types";
import { Readable } from "stream";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export const r2Backend: StorageBackend = {
  async upload(buffer, key, contentType) {
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    if (process.env.R2_PUBLIC_URL) {
      return `${process.env.R2_PUBLIC_URL}/${key}`;
    }
    return this.getUrl(key);
  },

  async getUrl(key) {
    if (process.env.R2_PUBLIC_URL) {
      return `${process.env.R2_PUBLIC_URL}/${key}`;
    }
    return getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 }
    );
  },

  async getObject(key) {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key })
    );
    if (!res.Body) {
      throw new Error(`R2 object missing body: ${key}`);
    }
    // The AWS SDK returns the body as a Node Readable in Node runtimes.
    // Convert to a Web ReadableStream so the route handler can return it
    // directly via NextResponse.
    const nodeStream = res.Body as Readable;
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return {
      body: webStream,
      contentType: res.ContentType ?? null,
      contentLength: res.ContentLength ?? null,
    };
  },

  async delete(key) {
    await r2.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
    );
  },
};
