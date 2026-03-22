export interface StorageBackend {
  upload(buffer: Buffer, key: string, contentType: string): Promise<string>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
