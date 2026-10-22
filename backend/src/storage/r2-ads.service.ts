import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AppConfigService } from '../config/app-config.service';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class R2AdsService {
  private readonly logger = new Logger(R2AdsService.name);
  private client: S3Client | null = null;

  constructor(private readonly config: AppConfigService) {}

  get configured(): boolean {
    return Boolean(
      this.config.r2AccountId &&
        this.config.r2AccessKeyId &&
        this.config.r2SecretAccessKey &&
        this.config.r2BucketAds &&
        this.config.r2PublicBaseUrl,
    );
  }

  private getS3(): S3Client {
    if (!this.configured) {
      throw new ServiceUnavailableException('Ad image upload is not configured (set R2_* env vars).');
    }
    if (!this.client) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.config.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.config.r2AccessKeyId,
          secretAccessKey: this.config.r2SecretAccessKey,
        },
      });
    }
    return this.client;
  }

  async uploadAdImage(file: { buffer: Buffer; mimetype: string; originalname: string; size: number }): Promise<{
    imageUrl: string;
    key: string;
  }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image file received.');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`Image must be at most ${MAX_BYTES / (1024 * 1024)} MB.`);
    }
    const extFromMime = ALLOWED_MIME[file.mimetype];
    if (!extFromMime) {
      throw new BadRequestException('Only JPEG, PNG, WebP or GIF images are allowed.');
    }
    const fromName = extname(file.originalname || '').toLowerCase();
    const ext = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fromName)
      ? fromName === '.jpeg'
        ? '.jpg'
        : fromName
      : extFromMime;
    // Bucket is already named "ads"; store objects at the bucket root.
    const key = `${randomUUID()}${ext}`;
    try {
      await this.getS3().send(
        new PutObjectCommand({
          Bucket: this.config.r2BucketAds,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch {
      this.logger.error(`R2 upload failed for ${key}`);
      throw new ServiceUnavailableException('Could not upload the image to storage. Try again or paste a URL.');
    }
    const base = this.config.r2PublicBaseUrl.replace(/\/+$/, '');
    return { imageUrl: `${base}/${key}`, key };
  }
}
