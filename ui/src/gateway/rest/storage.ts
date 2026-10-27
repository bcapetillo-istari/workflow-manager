/**
 * Content-addressed blob storage, replicating the Python SDK (istari_digital_core.Token):
 *   sha  = SHA-384( bytes || ascii(saltHex) )  as lowercase hex (96 chars)
 *   salt = 32 lowercase hex chars (uuid4().hex), one fresh salt per token
 * Upload:   GET /v2/tokens/{sha}/upload-url -> { url } then PUT bytes to the presigned URL
 *           (Content-Type: application/octet-stream, no Authorization). A 409 on upload-url
 *           means the blob already exists and is skipped, exactly as the SDK does.
 * Download: GET /v2/tokens/{sha}/download-url -> { url } then GET it; the hash is re-verified.
 */
import { GatewayError } from '../types';
import type { HttpClient } from './http';

/** Optional rewrite applied to presigned object-store URLs (used by the dev proxy; identity in production). */
export type UrlRewrite = (url: string) => string;

export interface StorageToken {
  sha: string;
  salt: string;
}

export interface BlobMeta {
  fileName: string;
  extension: string;
  mime: string | null;
  description?: string | null;
  versionName?: string | null;
  externalIdentifier?: string | null;
  displayName?: string | null;
}

export interface UploadedBlob extends BlobMeta {
  size: number;
  contentToken: StorageToken;
  propertiesToken: StorageToken;
}

interface TemporaryUrl {
  url: string;
  expires?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeUtf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function saltedSha384(bytes: Uint8Array, saltHex: string): Promise<string> {
  const salt = encoder.encode(saltHex);
  const combined = new Uint8Array(bytes.length + salt.length);
  combined.set(bytes, 0);
  combined.set(salt, bytes.length);
  const digest = await crypto.subtle.digest('SHA-384', combined);
  return toHex(new Uint8Array(digest));
}

export async function makeToken(bytes: Uint8Array, salt = randomSaltHex()): Promise<StorageToken> {
  return { sha: await saltedSha384(bytes, salt), salt };
}

/**
 * Properties blob, byte-for-byte like the SDK's `Properties.to_bytes()`:
 * `json.dumps(model_dump(), separators=(',', ':'))` with every field present (None -> null).
 */
export function propertiesBytes(meta: BlobMeta, size: number): Uint8Array<ArrayBuffer> {
  const props = {
    file_name: meta.fileName,
    size,
    extension: meta.extension,
    mime: meta.mime ?? null,
    description: meta.description ?? null,
    version_name: meta.versionName ?? null,
    external_identifier: meta.externalIdentifier ?? null,
    display_name: meta.displayName ?? null,
  };
  return encoder.encode(JSON.stringify(props));
}

async function putBlob(
  http: HttpClient,
  sha: string,
  bytes: Uint8Array<ArrayBuffer>,
  rewrite?: UrlRewrite,
): Promise<void> {
  let target: TemporaryUrl;
  try {
    target = await http.get<TemporaryUrl>(`/v2/tokens/${sha}/upload-url`);
  } catch (err) {
    if (err instanceof GatewayError && err.status === 409) return; // blob already stored
    throw err;
  }
  let res: Response;
  try {
    res = await fetch(rewrite ? rewrite(target.url) : target.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
  } catch (cause) {
    throw new GatewayError('Blob upload: network error', { cause });
  }
  if (!res.ok) {
    throw new GatewayError(`Blob upload failed: HTTP ${res.status}`, {
      status: res.status,
      body: await res.text().catch(() => ''),
    });
  }
}

/** Upload a content blob plus its properties blob; returns the tokens needed to register a revision. */
export async function uploadBlob(
  http: HttpClient,
  content: Uint8Array<ArrayBuffer>,
  meta: BlobMeta,
  rewrite?: UrlRewrite,
): Promise<UploadedBlob> {
  const size = content.byteLength;
  const props = propertiesBytes(meta, size);
  const [propertiesToken, contentToken] = await Promise.all([makeToken(props), makeToken(content)]);
  await putBlob(http, propertiesToken.sha, props, rewrite);
  await putBlob(http, contentToken.sha, content, rewrite);
  return { ...meta, size, contentToken, propertiesToken };
}

/** Download and hash-verify the blob behind a token. */
export async function downloadBlob(
  http: HttpClient,
  token: StorageToken,
  rewrite?: UrlRewrite,
): Promise<Uint8Array<ArrayBuffer>> {
  const target = await http.get<TemporaryUrl>(`/v2/tokens/${token.sha}/download-url`);
  let res: Response;
  try {
    res = await fetch(rewrite ? rewrite(target.url) : target.url, { method: 'GET' });
  } catch (cause) {
    throw new GatewayError('Blob download: network error', { cause });
  }
  if (!res.ok) {
    throw new GatewayError(`Blob download failed: HTTP ${res.status}`, {
      status: res.status,
      body: await res.text().catch(() => ''),
    });
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha = await saltedSha384(bytes, token.salt);
  if (sha !== token.sha) {
    throw new GatewayError('Downloaded content does not match its token hash', {
      body: { expected: token.sha, sha },
    });
  }
  return bytes;
}
