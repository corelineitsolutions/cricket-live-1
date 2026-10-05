import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';
import { DEVICE_PLATFORMS, DevicePlatformValue } from './register-device.dto';

/** What the app gets back. The FCM token is never echoed. */
export class DeviceResponseDto {
  @ApiProperty({ example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04' })
  deviceId!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS, example: 'android' })
  platform!: DevicePlatformValue;

  @ApiProperty({ type: String, nullable: true, example: '1.0.0' })
  appVersion!: string | null;

  @ApiProperty({ example: true, description: 'False after deactivation; push notifications are not sent to it.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time', description: 'Last registration or deactivation call from this device.' })
  lastSeenAt!: string;
}

export class DeviceEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: DeviceResponseDto })
  data!: DeviceResponseDto;
}

export class AdminDeviceDto extends DeviceResponseDto {
  @ApiProperty({ example: 'clx1device00000000000001', description: 'Internal row id.' })
  id!: string;

  @ApiProperty({ example: 'dGhpc2…x9Zk', description: 'First 6 and last 4 characters of the FCM token. The full token is never returned.' })
  fcmTokenMasked!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminDeviceListEnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: [AdminDeviceDto] })
  data!: AdminDeviceDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
