import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import type { StorageBackend } from "./types";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

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

  async delete(key) {
    const filePath = path.join(UPLOADS_DIR, key);
    try {
      await unlink(filePath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  },
};
