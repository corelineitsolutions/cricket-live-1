import { DevicePlatform, FcmDevice } from '@prisma/client';
import { AdminDeviceDto, DeviceResponseDto } from './dto/device.response.dto';
import type { DevicePlatformValue } from './dto/register-device.dto';

export function toPlatformEnum(platform: DevicePlatformValue): DevicePlatform {
  return platform === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID;
}

export function fromPlatformEnum(platform: DevicePlatform): DevicePlatformValue {
  return platform === DevicePlatform.IOS ? 'ios' : 'android';
}

/** Enough to tell tokens apart in the admin UI, never enough to send a push. */
export function maskToken(token: string): string {
  return token.length < 16 ? '****' : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function toDeviceResponse(device: FcmDevice): DeviceResponseDto {
  return {
    deviceId: device.deviceId,
    platform: fromPlatformEnum(device.platform),
    appVersion: device.appVersion,
    isActive: device.isActive,
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

export function toAdminDevice(device: FcmDevice): AdminDeviceDto {
  return {
    id: device.id,
    ...toDeviceResponse(device),
    fcmTokenMasked: maskToken(device.fcmToken),
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}
