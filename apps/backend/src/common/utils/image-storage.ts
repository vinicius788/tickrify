import { randomUUID } from 'crypto';
import { UploadedFile } from '../interfaces/multer';

export interface PreparedImage {
  buffer: Buffer;
  mimeType: string;
  dataUrl: string;
  extension: string;
}

function normalizeMimeType(value?: string): string {
  const mimeType = String(value || '').trim().toLowerCase();
  if (!mimeType) {
    return 'image/png';
  }
  return mimeType;
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

export function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = String(dataUrl || '')
    .trim()
    .match(/^data:(.+?);base64,(.+)$/i);

  if (!match) {
    throw new Error('Invalid base64 image payload');
  }

  const mimeType = normalizeMimeType(match[1]);
  const buffer = Buffer.from(match[2], 'base64');

  if (!buffer.length) {
    throw new Error('Empty base64 image payload');
  }

  return { buffer, mimeType };
}

export function encodeDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export function prepareIncomingImage(
  imageFile?: UploadedFile,
  base64Image?: string,
): PreparedImage {
  if (imageFile?.buffer?.length) {
    const mimeType = normalizeMimeType(imageFile.mimetype);
    return {
      buffer: imageFile.buffer,
      mimeType,
      extension: extensionFromMimeType(mimeType),
      dataUrl: encodeDataUrl(imageFile.buffer, mimeType),
    };
  }

  if (base64Image) {
    const trimmed = base64Image.trim();
    const dataUrl = trimmed.startsWith('data:')
      ? trimmed
      : `data:image/png;base64,${trimmed}`;
    const decoded = decodeDataUrl(dataUrl);
    return {
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      extension: extensionFromMimeType(decoded.mimeType),
      dataUrl,
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
    const runtimeEnv = String(process.env.APP_ENV || process.env.NODE_ENV || 'development')
      .trim()
      .toLowerCase();
    return runtimeEnv === 'production';
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

    const extension = params.extension || extensionFromMimeType(params.mimeType);
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
        'content-type': params.mimeType,
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
