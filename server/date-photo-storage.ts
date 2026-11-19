import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { Pool } from 'pg';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';

export interface DatePhotoStorage {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export function s3DatePhotoStorage(config: Config): DatePhotoStorage | null {
  if (!config.datePhotoS3Endpoint) return null;
  const client = new S3Client({
    endpoint: config.datePhotoS3Endpoint,
    region: config.datePhotoS3Region,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: config.datePhotoS3AccessKeyId, secretAccessKey: config.datePhotoS3SecretAccessKey },
  });
  const Bucket = config.datePhotoS3Bucket;
  return {
    async put(Key, Body) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/jpeg', CacheControl: 'private, no-store' }));
    },
    async get(Key) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key }));
      if (!response.Body) throw new AppError(404, 'PHOTO_NOT_FOUND');
      return Buffer.from(await response.Body.transformToByteArray());
    },
    async delete(Key) { await client.send(new DeleteObjectCommand({ Bucket, Key })); },
  };
}

export async function prepareDatePhoto(base64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 5_600_000) throw new AppError(400, 'PHOTO_INVALID');
  const input = Buffer.from(base64, 'base64');
  if (input.length < 100 || input.length > 4_000_000) throw new AppError(400, 'PHOTO_INVALID');
  try {
    const metadata = await sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 320 ||
      metadata.width > 8000 || metadata.height > 8000 || (metadata.pages ?? 1) !== 1 ||
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new Error('unsupported image');
    // Re-encoding removes EXIF, GPS and other source metadata; no raw upload is stored.
    const full = await sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' })
      .autoOrient().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const thumbnail = await sharp(full).resize(360, 360, { fit: 'cover', position: 'attention' }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    return { id: randomUUID(), full, thumbnail };
  } catch { throw new AppError(400, 'PHOTO_INVALID'); }
}

export async function cleanupDatePhotoDeletions(pool: Pool, storage: DatePhotoStorage | null, limit = 20) {
  if (!storage) return;
  const rows = (await pool.query('SELECT object_key FROM date_photo_deletions ORDER BY queued_at LIMIT $1', [limit])).rows;
  for (const row of rows) {
    try {
      await storage.delete(row.object_key);
      await pool.query('DELETE FROM date_photo_deletions WHERE object_key=$1', [row.object_key]);
    } catch {
      await pool.query('UPDATE date_photo_deletions SET attempts=attempts+1 WHERE object_key=$1', [row.object_key]);
    }
  }
}
