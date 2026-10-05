import { Injectable, Logger } from '@nestjs/common';
import { notFound, validationError } from '../common/utils/http-errors';
import { buildPagination } from '../common/utils/pagination';
import { logEvent } from '../common/utils/structured-log';
import { FirebaseService } from '../firebase/firebase.service';
import { DeviceResponseDto } from './dto/device.response.dto';
import { ListDevicesQueryDto } from './dto/list-devices.query.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { toAdminDevice, toDeviceResponse, toPlatformEnum } from './fcm.mapper';
import { FcmRepository } from './fcm.repository';

/** FCM multicast limit per request. */
export const FCM_BATCH_SIZE = 500;

/** Firebase errors that mean the token will never work again. */
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export interface PushNotification {
  title: string;
  body: string;
  /** String key/values delivered to the app (e.g. { matchId: "61521" }). */
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface PushResult {
  /** Active devices found for the request. */
  targeted: number;
  sent: number;
  failed: number;
  /** Devices switched to inactive because Firebase rejected their token. */
  deactivated: number;
  skipped: 'firebase_not_configured' | 'no_active_devices' | null;
}

/**
 * Device registry and push delivery. Pushes are for notification features (match start,
 * result, ...). Live scores go over the WebSocket, never through FCM.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(
    private readonly devices: FcmRepository,
    private readonly firebase: FirebaseService,
  ) {}

  /** Creates the device or updates it in place (new token, version, last seen) and reactivates it. */
  async registerDevice(dto: RegisterDeviceDto): Promise<DeviceResponseDto> {
    await this.devices.deactivateOtherTokens(dto.deviceId, dto.fcmToken);
    const device = await this.devices.upsert({
      deviceId: dto.deviceId,
      fcmToken: dto.fcmToken,
      platform: toPlatformEnum(dto.platform),
      appVersion: dto.appVersion ?? null,
      lastSeenAt: new Date(),
    });
    return toDeviceResponse(device);
  }

  /** Stops pushes to a device. The row is kept for history. */
  async deactivateDevice(deviceId: string): Promise<DeviceResponseDto> {
    const existing = await this.devices.findByDeviceId(deviceId);
    if (!existing) {
      throw notFound('Device not found');
    }
    return toDeviceResponse(await this.devices.deactivate(deviceId));
  }

  sendToDevice(deviceId: string, notification: PushNotification): Promise<PushResult> {
    return this.sendToDevices([deviceId], notification);
  }

  async sendToDevices(deviceIds: string[], notification: PushNotification): Promise<PushResult> {
    this.assertNotification(notification);
    const result: PushResult = { targeted: 0, sent: 0, failed: 0, deactivated: 0, skipped: null };
    const unique = [...new Set(deviceIds)];
    const messaging = this.firebase.getMessaging();
    if (!messaging) {
      logEvent(this.logger, 'warn', 'push-skipped', { reason: 'firebase_not_configured', devices: unique.length });
      return { ...result, skipped: 'firebase_not_configured' };
    }

    const targets = unique.length > 0 ? await this.devices.findActiveByDeviceIds(unique) : [];
    result.targeted = targets.length;
    if (targets.length === 0) {
      return { ...result, skipped: 'no_active_devices' };
    }

    for (let start = 0; start < targets.length; start += FCM_BATCH_SIZE) {
      const tokens = targets.slice(start, start + FCM_BATCH_SIZE).map((target) => target.fcmToken);
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: notification.title, body: notification.body, imageUrl: notification.imageUrl },
        data: notification.data,
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      result.sent += response.successCount;
      result.failed += response.failureCount;

      const dead = response.responses
        .map((item, index) => (!item.success && DEAD_TOKEN_ERRORS.has(item.error?.code ?? '') ? tokens[index] : null))
        .filter((token): token is string => token !== null);
      if (dead.length > 0) {
        result.deactivated += (await this.devices.deactivateTokens(dead)).count;
      }
    }

    logEvent(this.logger, 'log', 'push-sent', {
      targeted: result.targeted,
      sent: result.sent,
      failed: result.failed,
      deactivated: result.deactivated,
    });
    return result;
  }

  async listForAdmin(query: ListDevicesQueryDto) {
    const { items, total } = await this.devices.list({
      ...query,
      platform: query.platform ? toPlatformEnum(query.platform) : undefined,
    });
    return { items: items.map(toAdminDevice), meta: buildPagination(query.page, query.limit, total) };
  }

  countSummary() {
    return this.devices.countSummary();
  }

  private assertNotification(notification: PushNotification): void {
    if (!notification.title.trim() || notification.title.length > 200 || !notification.body.trim() || notification.body.length > 1000) {
      throw validationError('Push title (1-200 chars) and body (1-1000 chars) are required');
    }
  }
}
