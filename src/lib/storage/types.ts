export interface StorageObject {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  contentLength: number | null;
}

export interface StorageBackend {
  upload(buffer: Buffer, key: string, contentType: string): Promise<string>;
  getUrl(key: string): Promise<string>;
  getObject(key: string): Promise<StorageObject>;
  delete(key: string): Promise<void>;
}
