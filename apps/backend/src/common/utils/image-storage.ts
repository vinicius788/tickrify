import { randomUUID } from 'crypto';
import { UploadedFile } from '../interfaces/multer';
import { isProductionRuntime } from './runtime-env';

export interface PreparedImage {
  buffer: Buffer;
  mimeType: string;
  dataUrl: string;
  extension: string;
}

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MAX_IMAGE_BYTES = (() => {
  const configured = Number(process.env.MAX_IMAGE_UPLOAD_BYTES || DEFAULT_MAX_IMAGE_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_IMAGE_BYTES;
  }
  return Math.floor(configured);
})();

function normalizeMimeType(value?: string): string | undefined {
  const mimeType = String(value || '')
    .trim()
    .toLowerCase();
  if (!mimeType) {
    return undefined;
  }
  if (mimeType === 'image/jpg') {
    return 'image/jpeg';
  }
  return mimeType;
}

function parseDataUrl(value: string): { mimeType?: string; base64Payload: string } {
  const match = String(value || '')
    .trim()
    .match(/^data:([^;,]+)(?:;[^,]*)?;base64,([a-z0-9+/=\s]+)$/i);

  if (!match) {
    throw new Error('Invalid base64 image payload');
  }

  return {
    mimeType: normalizeMimeType(match[1]),
    base64Payload: match[2],
  };
}

function decodeBase64Payload(payload: string): Buffer {
  const normalized = String(payload || '').replace(/\s+/g, '');
  if (!normalized) {
    throw new Error('Empty base64 image payload');
  }

  if (!/^[a-z0-9+/]+={0,2}$/i.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('Invalid base64 image payload');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length) {
    throw new Error('Empty base64 image payload');
  }

  return buffer;
}

function detectMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

function formatAllowedImageTypes(): string {
  return 'PNG, JPG/JPEG, WEBP';
}

function validateImagePayload(buffer: Buffer, declaredMimeType?: string): { mimeType: string; extension: string } {
  if (!buffer?.length) {
    throw new Error('Empty image payload');
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    const maxMb = Math.floor(MAX_IMAGE_BYTES / (1024 * 1024));
    throw new Error(`Image exceeds maximum size of ${maxMb}MB`);
  }

  const detectedMimeType = detectMimeTypeFromBuffer(buffer);
  if (!detectedMimeType) {
    throw new Error(`Unsupported image format. Allowed: ${formatAllowedImageTypes()}`);
  }

  const normalizedDeclared = normalizeMimeType(declaredMimeType);
  if (normalizedDeclared && !ALLOWED_IMAGE_MIME_TYPES.has(normalizedDeclared)) {
    throw new Error(`Unsupported image format. Allowed: ${formatAllowedImageTypes()}`);
  }

  if (normalizedDeclared && normalizedDeclared !== detectedMimeType) {
    throw new Error('Image MIME type does not match file signature');
  }

  const finalMimeType = normalizedDeclared || detectedMimeType;
  return {
    mimeType: finalMimeType,
    extension: extensionFromMimeType(finalMimeType),
  };
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}

export function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const parsed = parseDataUrl(dataUrl);
  const buffer = decodeBase64Payload(parsed.base64Payload);
  const validated = validateImagePayload(buffer, parsed.mimeType);

  return { buffer, mimeType: validated.mimeType };
}

export function encodeDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export function prepareIncomingImage(
  imageFile?: UploadedFile,
  base64Image?: string,
): PreparedImage {
  if (imageFile?.buffer?.length) {
    const validated = validateImagePayload(imageFile.buffer, imageFile.mimetype);
    return {
      buffer: imageFile.buffer,
      mimeType: validated.mimeType,
      extension: validated.extension,
      dataUrl: encodeDataUrl(imageFile.buffer, validated.mimeType),
    };
  }

  if (base64Image) {
    const trimmed = base64Image.trim();
    let declaredMimeType: string | undefined;
    let base64Payload = trimmed;

    if (trimmed.startsWith('data:')) {
      const parsed = parseDataUrl(trimmed);
      declaredMimeType = parsed.mimeType;
      base64Payload = parsed.base64Payload;
    }

    const buffer = decodeBase64Payload(base64Payload);
    const validated = validateImagePayload(buffer, declaredMimeType);

    return {
      buffer,
      mimeType: validated.mimeType,
      extension: validated.extension,
      dataUrl: encodeDataUrl(buffer, validated.mimeType),
    };
  }

  throw new Error('No image provided');
}

export class ImageStorageClient {
  private readonly supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
  private readonly serviceKey =
    process.env.SUPABASE_SERVICE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    '';
  private readonly bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'analysis-images';

  isConfigured(): boolean {
    return Boolean(this.supabaseUrl && this.serviceKey && this.bucket);
  }

  requiresRemoteStorage(): boolean {
    return isProductionRuntime();
  }

  async uploadBuffer(params: {
    buffer: Buffer;
    mimeType: string;
    pathPrefix: string;
    extension?: string;
  }): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Supabase Storage is not configured');
    }

    const validated = validateImagePayload(params.buffer, params.mimeType);
    const extension = params.extension || validated.extension;
    const objectPath = `${params.pathPrefix}/${Date.now()}-${randomUUID()}.${extension}`.replace(
      /\/+/g,
      '/',
    );

    const endpoint = `${this.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${
      this.bucket
    }/${objectPath}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'content-type': validated.mimeType,
        'x-upsert': 'true',
      },
      body: new Uint8Array(params.buffer),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Failed to upload image to storage (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const publicBase =
      process.env.SUPABASE_STORAGE_PUBLIC_BASE_URL?.trim() ||
      `${this.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public`;

    return `${publicBase}/${this.bucket}/${objectPath}`;
  }

  async uploadDataUrl(dataUrl: string, pathPrefix: string): Promise<string> {
    const decoded = decodeDataUrl(dataUrl);
    return this.uploadBuffer({
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      extension: extensionFromMimeType(decoded.mimeType),
      pathPrefix,
    });
  }
}
