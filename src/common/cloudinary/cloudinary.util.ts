import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export type PortfolioResourceKind = 'IMAGE' | 'VIDEO';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  uploadPreset: string | null;
  folderPrefix: string;
  allowedImageFormats: string[];
  allowedVideoFormats: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
}

const PLACEHOLDER_VALUES = new Set([
  '',
  'your_cloud_name',
  'your_api_key',
  'your_api_secret',
  'replace-with-cloudinary-cloud-name',
  'replace-with-cloudinary-api-key',
  'replace-with-cloudinary-api-secret',
]);

function isMissingOrPlaceholder(val?: string): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return PLACEHOLDER_VALUES.has(trimmed) || PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

export function loadCloudinaryConfig(env: NodeJS.ProcessEnv = process.env): CloudinaryConfig {
  const rawImageFormats =
    env.PORTFOLIO_ALLOWED_IMAGE_FORMATS || 'jpg,jpeg,png,webp,avif,heic';
  const rawVideoFormats = env.PORTFOLIO_ALLOWED_VIDEO_FORMATS || 'mp4,webm,mov';

  const maxImageBytes = Number(env.PORTFOLIO_MAX_IMAGE_BYTES) || 15 * 1024 * 1024;
  const maxVideoBytes = Number(env.PORTFOLIO_MAX_VIDEO_BYTES) || 100 * 1024 * 1024;

  const folderPrefix = (env.CLOUDINARY_FOLDER_PREFIX || 'softilo/portfolio')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  const preset = env.CLOUDINARY_UPLOAD_PRESET?.trim();
  const uploadPreset =
    preset && !PLACEHOLDER_VALUES.has(preset.toLowerCase()) ? preset : null;

  return {
    cloudName: (env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey: (env.CLOUDINARY_API_KEY || '').trim(),
    apiSecret: (env.CLOUDINARY_API_SECRET || '').trim(),
    uploadPreset,
    folderPrefix: folderPrefix || 'softilo/portfolio',
    allowedImageFormats: rawImageFormats
      .split(',')
      .map((f) => f.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
    allowedVideoFormats: rawVideoFormats
      .split(',')
      .map((f) => f.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
    maxImageBytes,
    maxVideoBytes,
  };
}

/**
 * Verifies required Cloudinary credentials exist without ever exposing secret values.
 */
export function assertCloudinaryCredentials(config: CloudinaryConfig): void {
  const missingVariables: string[] = [];
  if (isMissingOrPlaceholder(config.cloudName)) {
    missingVariables.push('CLOUDINARY_CLOUD_NAME');
  }
  if (isMissingOrPlaceholder(config.apiKey)) {
    missingVariables.push('CLOUDINARY_API_KEY');
  }
  if (isMissingOrPlaceholder(config.apiSecret)) {
    missingVariables.push('CLOUDINARY_API_SECRET');
  }

  if (missingVariables.length > 0) {
    throw new BadRequestException({
      code: 'MISSING_CLOUDINARY_CREDENTIALS',
      message: `Missing required Cloudinary environment variables: ${missingVariables.join(', ')}. Configure them in .env (see docs/EXTERNAL_SERVICES.md).`,
      missingVariables,
    });
  }
}

export interface CloudinaryStatusSummary {
  configured: boolean;
  missingVariables: string[];
  cloudName: string | null;
  folderPrefix: string;
  allowedImageFormats: string[];
  allowedVideoFormats: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
}

/**
 * Returns non-secret Cloudinary configuration status so the admin UI can show
 * clear setup guidance if credentials are still placeholders.
 */
export function getCloudinaryStatus(config: CloudinaryConfig): CloudinaryStatusSummary {
  const missingVariables: string[] = [];
  if (isMissingOrPlaceholder(config.cloudName)) missingVariables.push('CLOUDINARY_CLOUD_NAME');
  if (isMissingOrPlaceholder(config.apiKey)) missingVariables.push('CLOUDINARY_API_KEY');
  if (isMissingOrPlaceholder(config.apiSecret)) missingVariables.push('CLOUDINARY_API_SECRET');

  return {
    configured: missingVariables.length === 0,
    missingVariables,
    cloudName: isMissingOrPlaceholder(config.cloudName) ? null : config.cloudName,
    folderPrefix: config.folderPrefix,
    allowedImageFormats: config.allowedImageFormats,
    allowedVideoFormats: config.allowedVideoFormats,
    maxImageBytes: config.maxImageBytes,
    maxVideoBytes: config.maxVideoBytes,
  };
}

/**
 * Best-effort signed Cloudinary destroy API call so deleted gallery assets
 * are also cleaned up from Cloudinary storage.
 */
export async function destroyCloudinaryAsset(
  config: CloudinaryConfig,
  publicId: string,
  resourceType: PortfolioResourceKind,
): Promise<boolean> {
  if (
    isMissingOrPlaceholder(config.cloudName) ||
    isMissingOrPlaceholder(config.apiKey) ||
    isMissingOrPlaceholder(config.apiSecret) ||
    !publicId
  ) {
    return false;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = computeCloudinarySignature(
      { invalidate: 'true', public_id: publicId, timestamp },
      config.apiSecret,
    );
    const endpointResource = resourceType === 'VIDEO' ? 'video' : 'image';
    const body = new URLSearchParams({
      public_id: publicId,
      api_key: config.apiKey,
      timestamp: String(timestamp),
      invalidate: 'true',
      signature,
    });

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${endpointResource}/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Generates Cloudinary SHA-1 signature for signed upload parameters.
 * Keys are sorted alphabetically; `file`, `cloud_name`, `resource_type`, and `api_key` are excluded per Cloudinary spec.
 */
export function computeCloudinarySignature(
  params: Record<string, string | number | undefined | null>,
  apiSecret: string,
): string {
  const excludedKeys = new Set(['file', 'cloud_name', 'resource_type', 'api_key']);
  const serialized = Object.keys(params)
    .filter((key) => !excludedKeys.has(key) && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1')
    .update(`${serialized}${apiSecret}`, 'utf8')
    .digest('hex');
}

export function validateMediaFormatAndSize(
  config: CloudinaryConfig,
  resourceType: PortfolioResourceKind,
  rawFormat: string,
  bytes: number,
): { normalizedFormat: string; allowedFormats: string[]; maxBytes: number } {
  const normalizedFormat = rawFormat
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/^image\//, '')
    .replace(/^video\//, '')
    .replace(/^quicktime$/, 'mov');

  const allowedFormats =
    resourceType === 'VIDEO' ? config.allowedVideoFormats : config.allowedImageFormats;
  const maxBytes = resourceType === 'VIDEO' ? config.maxVideoBytes : config.maxImageBytes;

  if (!allowedFormats.includes(normalizedFormat)) {
    throw new BadRequestException(
      `Unsupported ${resourceType.toLowerCase()} format "${normalizedFormat}". Allowed formats: ${allowedFormats.join(', ')}.`,
    );
  }

  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new BadRequestException('File size (bytes) must be a positive integer.');
  }

  if (bytes > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
    const actualMb = (bytes / (1024 * 1024)).toFixed(1);
    throw new BadRequestException(
      `${resourceType === 'VIDEO' ? 'Video' : 'Image'} file size (${actualMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`,
    );
  }

  return { normalizedFormat, allowedFormats, maxBytes };
}

export interface SignedUploadPayload {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  signature: string;
  timestamp: number;
  folder: string;
  allowedFormats: string[];
  context: string;
  uploadPreset: string | null;
  resourceType: PortfolioResourceKind;
  maxBytes: number;
}

export function createSignedUploadPayload(options: {
  config: CloudinaryConfig;
  eventId: string;
  resourceType: PortfolioResourceKind;
  format: string;
  bytes: number;
  nowUnixSeconds?: number;
}): SignedUploadPayload {
  const { config, eventId, resourceType, format, bytes } = options;
  assertCloudinaryCredentials(config);

  const { allowedFormats, maxBytes } = validateMediaFormatAndSize(
    config,
    resourceType,
    format,
    bytes,
  );

  const timestamp = options.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const folder = `${config.folderPrefix}/${eventId}`;
  const context = `event_id=${eventId}`;

  const paramsToSign: Record<string, string | number | undefined> = {
    allowed_formats: allowedFormats.join(','),
    context,
    folder,
    timestamp,
    ...(config.uploadPreset ? { upload_preset: config.uploadPreset } : {}),
  };

  const signature = computeCloudinarySignature(paramsToSign, config.apiSecret);
  const endpointResource = resourceType === 'VIDEO' ? 'video' : 'image';

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${endpointResource}/upload`,
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    signature,
    timestamp,
    folder,
    allowedFormats,
    context,
    uploadPreset: config.uploadPreset,
    resourceType,
    maxBytes,
  };
}

export function verifyUploadedAssetMetadata(options: {
  config: CloudinaryConfig;
  eventId: string;
  publicId: string;
  resourceType: PortfolioResourceKind;
  format: string;
  secureUrl: string;
  bytes: number;
  version?: number;
  responseSignature?: string;
}): void {
  const {
    config,
    eventId,
    publicId,
    resourceType,
    format,
    secureUrl,
    bytes,
    version,
    responseSignature,
  } = options;

  validateMediaFormatAndSize(config, resourceType, format, bytes);

  const expectedFolderPrefix = `${config.folderPrefix}/${eventId}/`;
  if (!publicId.startsWith(expectedFolderPrefix)) {
    throw new BadRequestException(
      `Invalid publicId "${publicId}": asset must belong to event folder "${expectedFolderPrefix}".`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(secureUrl);
  } catch {
    throw new BadRequestException('secureUrl must be a valid HTTPS URL.');
  }

  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('cloudinary.com')) {
    throw new BadRequestException('secureUrl must be an HTTPS Cloudinary CDN URL.');
  }

  if (
    responseSignature &&
    version !== undefined &&
    !isMissingOrPlaceholder(config.apiSecret)
  ) {
    const expectedSig = computeCloudinarySignature(
      { public_id: publicId, version },
      config.apiSecret,
    );
    if (expectedSig !== responseSignature) {
      throw new BadRequestException('Cloudinary upload response signature verification failed.');
    }
  }
}

/**
 * Generates responsive & optimized Cloudinary delivery URLs (and lightweight poster URL for videos).
 */
export function buildCloudinaryDeliveryUrls(media: {
  secureUrl: string;
  publicId: string;
  resourceType: PortfolioResourceKind;
  format: string;
}): {
  coverUrl: string;
  thumbnailUrl: string;
  fullUrl: string;
  posterUrl: string | null;
} {
  const { secureUrl, resourceType } = media;
  if (!secureUrl.includes('/upload/')) {
    return {
      coverUrl: secureUrl,
      thumbnailUrl: secureUrl,
      fullUrl: secureUrl,
      posterUrl: resourceType === 'VIDEO' ? null : secureUrl,
    };
  }

  if (resourceType === 'VIDEO') {
    const posterUrl = secureUrl
      .replace('/upload/', '/upload/so_auto,f_jpg,q_auto,c_limit,w_960/')
      .replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
    const optimizedVideoUrl = secureUrl.replace('/upload/', '/upload/f_auto,q_auto/');
    return {
      coverUrl: posterUrl,
      thumbnailUrl: posterUrl,
      fullUrl: optimizedVideoUrl,
      posterUrl,
    };
  }

  return {
    coverUrl: secureUrl.replace('/upload/', '/upload/f_auto,q_auto,c_limit,w_1200/'),
    thumbnailUrl: secureUrl.replace('/upload/', '/upload/f_auto,q_auto,c_fill,g_auto,w_480,h_360/'),
    fullUrl: secureUrl.replace('/upload/', '/upload/f_auto,q_auto,c_limit,w_1920/'),
    posterUrl: null,
  };
}
