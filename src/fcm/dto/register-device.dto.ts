import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatformValue = (typeof DEVICE_PLATFORMS)[number];

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

const lowerCase = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Stable id generated once per app install (e.g. a UUID). This is not the FCM token.',
    example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId!: string;

  @ApiProperty({ description: 'Current FCM registration token. Send it again whenever Firebase rotates it.', minLength: 10, maxLength: 512 })
  @IsString()
  @MinLength(10)
  @MaxLength(512)
  @Matches(/^\S+$/, { message: 'fcmToken must not contain whitespace' })
  fcmToken!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS, example: 'android', description: 'Case-insensitive.' })
  @Transform(lowerCase)
  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatformValue;

  @ApiPropertyOptional({ example: '1.0.0', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9._+-]+$/, { message: 'appVersion may contain letters, digits, . _ + - only' })
  appVersion?: string;
}
