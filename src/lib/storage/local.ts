import { mkdir, writeFile, unlink, stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import type { StorageBackend } from "./types";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".gif": "image/gif",
};

export const localBackend: StorageBackend = {
  async upload(buffer, key, _contentType) {
    const filePath = path.join(UPLOADS_DIR, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    return `/api/uploads/${key}`;
  },

  async getUrl(key) {
    return `/api/uploads/${key}`;
  },

  async getObject(key) {
    const filePath = path.join(UPLOADS_DIR, key);
    if (!filePath.startsWith(UPLOADS_DIR)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const stats = await stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return {
      body: webStream,
      contentType: MIME_TYPES[ext] ?? "application/octet-stream",
      contentLength: stats.size,
    };
  },

  async delete(key) {
    const filePath = path.join(UPLOADS_DIR, key);
    try {
      await unlink(filePath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  },
};
