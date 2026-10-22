import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DEVICE_ID_PATTERN } from '../../fcm/dto/register-device.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Link this install to an existing Pro purchase that was paid with the same phone (no OTP). */
export class RestoreProDto {
  @ApiProperty({
    description: 'New phone’s install id (FCM deviceId).',
    example: '6f1c0b3e-8a2d-4c7a-9b11-2d5e7a9c1b04',
  })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(DEVICE_ID_PATTERN, { message: 'deviceId may contain letters, digits, _ . : - only' })
  deviceId!: string;

  @ApiProperty({
    description: 'Same phone used when they paid. Digits, optional + / spaces / dashes.',
    example: '9876543210',
  })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  @Matches(/^\+?[0-9\s-]{8,20}$/, { message: 'phone must be 8–20 digits (optional + / spaces / dashes)' })
  phone!: string;
}
