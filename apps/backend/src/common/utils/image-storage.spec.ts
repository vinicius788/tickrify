import { decodeDataUrl, ImageStorageClient, prepareIncomingImage } from './image-storage';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);

describe('image-storage validation', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts png file upload and normalizes payload', () => {
    const prepared = prepareIncomingImage({
      fieldname: 'image',
      originalname: 'chart.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: PNG_BYTES.length,
      buffer: PNG_BYTES,
    });

    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.extension).toBe('png');
    expect(prepared.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('accepts base64 image without data-url prefix', () => {
    const prepared = prepareIncomingImage(undefined, PNG_BYTES.toString('base64'));

    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.extension).toBe('png');
    expect(prepared.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects mime type mismatch with file signature', () => {
    expect(() =>
      prepareIncomingImage({
        fieldname: 'image',
        originalname: 'chart.jpg',
        encoding: '7bit',
        mimetype: 'image/png',
        size: JPEG_BYTES.length,
        buffer: JPEG_BYTES,
      }),
    ).toThrow('Image MIME type does not match file signature');
  });

  it('rejects unsupported mime types', () => {
    expect(() =>
      prepareIncomingImage({
        fieldname: 'image',
        originalname: 'chart.gif',
        encoding: '7bit',
        mimetype: 'image/gif',
        size: PNG_BYTES.length,
        buffer: PNG_BYTES,
      }),
    ).toThrow('Unsupported image format');
  });

  it('rejects malformed data-url payloads', () => {
    expect(() => decodeDataUrl('data:image/png;base64,not valid base64%%')).toThrow(
      'Invalid base64 image payload',
    );
  });

  it('respects USE_LOCAL_STORAGE in non-production runtime', () => {
    process.env.APP_ENV = 'development';
    process.env.USE_LOCAL_STORAGE = 'true';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'analysis-images';

    const storage = new ImageStorageClient();
    expect(storage.isConfigured()).toBe(false);
    expect(storage.requiresRemoteStorage()).toBe(false);
  });

  it('does not bypass remote storage requirements in production runtime', () => {
    process.env.APP_ENV = 'production';
    process.env.USE_LOCAL_STORAGE = 'true';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service-key';
    process.env.SUPABASE_STORAGE_BUCKET = 'analysis-images';

    const storage = new ImageStorageClient();
    expect(storage.isConfigured()).toBe(true);
    expect(storage.requiresRemoteStorage()).toBe(true);
  });
});
