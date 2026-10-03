import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { storageDriver } from "./config";

/**
 * File storage behind one interface, with two drivers:
 *  - "local": a folder on disk. For development and for hosts with a persistent disk.
 *  - "vercel-blob": a private Vercel Blob store. The browser uploads straight to the store (so files are not
 *    limited by the host's request-size cap), and downloads are streamed through our own authenticated route.
 */
export type Opened = { body: ReadableStream<Uint8Array>; partial: boolean };

export interface Storage {
  /** true when the browser sends the bytes directly to the store instead of through our server */
  readonly direct: boolean;
  put(key: string, data: Buffer): Promise<void>;
  /** Opens a stored file, optionally a byte range. `partial` says whether the range was honoured. */
  open(key: string, range?: { start: number; end: number }): Promise<Opened | null>;
  /** The first bytes of a file, for checking that its content matches its extension. */
  head(key: string, bytes: number): Promise<{ size: number; start: Buffer } | null>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  readonly direct = false;
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  async open(key: string, range?: { start: number; end: number }) {
    return { body: Readable.toWeb(createReadStream(this.resolve(key), range)) as ReadableStream<Uint8Array>, partial: !!range };
  }
  async head(key: string, bytes: number) {
    try {
      const handle = await fs.open(this.resolve(key), "r");
      const { size } = await handle.stat();
      const start = Buffer.alloc(Math.min(bytes, size));
      await handle.read(start, 0, start.length, 0);
      await handle.close();
      return { size, start };
    } catch {
      return null;
    }
  }
  read(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class VercelBlobStorage implements Storage {
  readonly direct = true;
  private sdk = () => import("@vercel/blob");

  async put(key: string, data: Buffer) {
    const { put } = await this.sdk();
    await put(key, data, { access: "public", addRandomSuffix: false });
  }
  async open(key: string, range?: { start: number; end: number }) {
    const { get } = await this.sdk();
    if (range) {
      // Ask the store for just the range. If it answers with the whole file, or not at all, fall back to the whole file.
      const part = await get(key, { access: "public", headers: { range: `bytes=${range.start}-${range.end}` } }).catch(() => null);
      if (part?.stream && part.headers.get("content-range")) return { body: part.stream, partial: true };
      if (part?.stream) return { body: part.stream, partial: false };
    }
    const whole = await get(key, { access: "public" });
    return whole?.stream ? { body: whole.stream, partial: false } : null;
  }
  async head(key: string, bytes: number) {
    const { get, head } = await this.sdk();
    try {
      const meta = await head(key);
      // Just uploaded, so read past the cache; take only the first bytes and drop the rest of the stream.
      const result = await get(key, { access: "public", useCache: false });
      if (!result?.stream) return null;
      const reader = result.stream.getReader();
      const chunks: Buffer[] = [];
      let have = 0;
      while (have < bytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        have += value.length;
      }
      await reader.cancel().catch(() => {});
      return { size: meta.size, start: Buffer.concat(chunks).subarray(0, bytes) };
    } catch {
      return null;
    }
  }
  async read(key: string) {
    const opened = await this.open(key);
    if (!opened) throw new Error("File not found in storage");
    return Buffer.from(await new Response(opened.body).arrayBuffer());
  }
  async delete(key: string) {
    const { del } = await this.sdk();
    await del(key);
  }
}

let instance: Storage | undefined;

export function storage(): Storage {
  if (!instance) {
    instance = storageDriver() === "vercel-blob" ? new VercelBlobStorage() : new LocalStorage(process.env.STORAGE_DIR ?? "./.data/files");
  }
  return instance;
}
